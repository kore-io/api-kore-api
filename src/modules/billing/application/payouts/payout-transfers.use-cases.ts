import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../../../shared/config/app-config.service';
import { BackofficeTransaction } from '../../../../shared/database/backoffice-transaction';
import {
  FIELD_CIPHER,
  type FieldCipher,
} from '../../../../shared/crypto/application/field-cipher.port';
import {
  EMAIL_OUTBOX,
  type EmailOutbox,
} from '../../../../shared/email/application/email-outbox.port';
import { PLANNER_COMMISSIONS_PATH } from '../../../notifications/application/rsvp-emails.use-cases';
import {
  PayoutAmountMismatchError,
  PayoutNotFoundError,
  PayoutPaymentsDisabledError,
  PayoutPixKeyChangePendingError,
  PayoutReferrerBlockedError,
  PayoutStatusConflictError,
} from '../../domain/payout.errors';
import { payoutPaidEmail } from '../../infrastructure/emails/payout.email';
import {
  GatewayUnavailableError,
  PAYMENT_GATEWAY,
  type GatewayTransfer,
  type PaymentGateway,
} from '../ports/payment-gateway.port';
import { PAYOUT_LEDGER, type LockedPayout, type PayoutLedger } from '../ports/payout-ledger.port';
import {
  PAYOUT_TRANSFER_QUEUE,
  type PayoutTransferQueue,
} from '../ports/payout-transfer-queue.port';

const logger = new Logger('PayoutTransfers');
const PIX_KEY_CONTEXT = { table: 'referrer_pix_keys', column: 'key_encrypted' };

export type PayoutSyncResult = 'paid' | 'failed' | 'pending' | 'unchanged' | 'not_found';

/**
 * O estado do Pix de saída aplicado ao repasse (Repasse RN05), pela
 * consulta, nunca pelo evento sozinho: pago → paid, as comissões pagas e o
 * "Repasse pago"; falha definitiva → requested e o alerta payout_failed;
 * pendente → nada. Só mexe no repasse em processamento.
 */
@Injectable()
export class SyncPayout {
  private readonly appUrl: string;

  constructor(
    private readonly transaction: BackofficeTransaction,
    @Inject(PAYOUT_LEDGER) private readonly ledger: PayoutLedger,
    @Inject(EMAIL_OUTBOX) private readonly outbox: EmailOutbox,
    config: AppConfigService,
  ) {
    this.appUrl = config.get({ key: 'APP_URL' }).replace(/\/+$/, '');
  }

  async execute({
    payoutId,
    transfer,
    now,
  }: {
    payoutId: string;
    transfer: GatewayTransfer;
    now: Date;
  }): Promise<PayoutSyncResult> {
    return this.transaction.run(async () => {
      const payout = await this.ledger.lock({ payoutId });
      if (!payout) return 'not_found';
      if (payout.status !== 'processing') return 'unchanged';
      if (transfer.status === 'paid') {
        await this.ledger.markPaid({ payoutId, transferId: transfer.gatewayTransferId, now });
        const recipient = await this.ledger.recipient({ userId: payout.referrerUserId });
        this.transaction.schedule(() =>
          this.outbox.enqueue({
            message: payoutPaidEmail({
              to: recipient.email,
              firstName: recipient.firstName,
              url: `${this.appUrl}${PLANNER_COMMISSIONS_PATH}`,
            }),
            priority: 'default',
          }),
        );
        return 'paid';
      }
      if (transfer.status === 'failed') {
        const reason = transfer.failureReason ?? 'failed';
        await this.ledger.markFailed({ payoutId, reason, now });
        await this.ledger.openFailedAlert({ payoutId, reason });
        return 'failed';
      }
      return 'pending';
    });
  }
}

/**
 * Pagar (Repasse RN05; a ação do Admin, cuja rota é do PR do backoffice): na
 * transação, confere a chave do ambiente, o indicador, a troca da chave e o
 * valor (B7-3), e passa a processing; o Pix sai depois do commit, pelo job
 * (G1).
 */
@Injectable()
export class PayPayout {
  private readonly enabled: boolean;

  constructor(
    private readonly transaction: BackofficeTransaction,
    @Inject(PAYOUT_LEDGER) private readonly ledger: PayoutLedger,
    @Inject(PAYOUT_TRANSFER_QUEUE) private readonly queue: PayoutTransferQueue,
    config: AppConfigService,
  ) {
    this.enabled = config.get({ key: 'PAYOUTS_ENABLED' });
  }

  /**
   * O `Idempotency-Key` (Backoffice - cobrança, Contrato de API; decisão 259(3)):
   * o mesmo pedido repetido depois do Pagar responde com o estado atual do
   * repasse, sem outro Pix; outra chave no repasse que já saiu de requested (a
   * segunda aba) é 409. Depois de uma falha definitiva o repasse volta a
   * requested, e aí a mesma chave paga de novo (um Pix novo, com a mesma
   * referência no gateway).
   */
  async execute({
    payoutId,
    adminUserId,
    idempotencyKey,
    now,
  }: {
    payoutId: string;
    adminUserId: string;
    idempotencyKey: string;
    now: Date;
  }): Promise<LockedPayout['status']> {
    if (!this.enabled) throw new PayoutPaymentsDisabledError();
    return this.transaction.run(async () => {
      const payout = await this.ledger.lock({ payoutId });
      if (!payout) throw new PayoutNotFoundError();
      if (payout.status !== 'requested') {
        if (await this.ledger.paidWithKey({ payoutId, idempotencyKey })) return payout.status;
        throw new PayoutStatusConflictError(payout.status, 'requested');
      }
      if (payout.referrerStatus !== 'active') throw new PayoutReferrerBlockedError();
      if (payout.pixKeyChangePending) throw new PayoutPixKeyChangePendingError();
      if (payout.amountCents !== payout.itemsCents)
        throw new PayoutAmountMismatchError(payout.amountCents, payout.itemsCents);
      // A ação que tira dinheiro do Kore fica no log (Backoffice - cobrança RN01; D19).
      await this.ledger.markProcessing({
        payoutId,
        paidByUserId: adminUserId,
        idempotencyKey,
        now,
      });
      this.transaction.schedule(() => this.queue.enqueue({ payoutId }));
      return 'processing' as const;
    });
  }
}

/**
 * O job do Pix de saída: consulta pela referência antes de mandar (o mesmo
 * repasse nunca manda dois Pix), manda para a chave do pedido e aplica o
 * resultado. Sem resposta (timeout, rede, 5xx): fica em processamento, com o
 * erro e o alerta payout_failed, e só o Admin tenta de novo (B7-2).
 */
@Injectable()
export class SendPayoutTransfer {
  constructor(
    private readonly transaction: BackofficeTransaction,
    @Inject(PAYOUT_LEDGER) private readonly ledger: PayoutLedger,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(FIELD_CIPHER) private readonly cipher: FieldCipher,
    private readonly sync: SyncPayout,
  ) {}

  async execute({ payoutId, now }: { payoutId: string; now: Date }): Promise<PayoutSyncResult> {
    const payout = await this.transaction.run(() => this.ledger.lock({ payoutId }));
    if (!payout) return 'not_found';
    if (payout.status !== 'processing') return 'unchanged';
    let transfer: GatewayTransfer;
    try {
      const existing = await this.gateway.getPixTransfer({ externalReference: payout.externalRef });
      transfer =
        existing ??
        (await this.gateway.sendPixTransfer({
          externalReference: payout.externalRef,
          amountCents: payout.amountCents,
          pixKey: await this.cipher.decrypt({
            ciphertext: payout.pixKey.encrypted,
            context: PIX_KEY_CONTEXT,
          }),
          pixKeyType: payout.pixKey.type,
        }));
    } catch (error) {
      if (!(error instanceof GatewayUnavailableError)) throw error;
      logger.warn(`Pix de saída sem resposta (${error.name}).`);
      await this.transaction.run(async () => {
        await this.ledger.markStuck({ payoutId, error: 'gateway_unavailable', now });
        await this.ledger.openFailedAlert({ payoutId, reason: 'gateway_unavailable' });
      });
      return 'pending';
    }
    return this.sync.execute({ payoutId, transfer, now });
  }
}

/**
 * Tentar de novo (Repasse RN05; a ação do Admin no repasse em processamento):
 * primeiro consulta o gateway pela referência; achou, aplica; não achou, o
 * job manda de novo (com a mesma referência, o Pix é idempotente).
 */
@Injectable()
export class RetryPayout {
  constructor(
    private readonly transaction: BackofficeTransaction,
    @Inject(PAYOUT_LEDGER) private readonly ledger: PayoutLedger,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(PAYOUT_TRANSFER_QUEUE) private readonly queue: PayoutTransferQueue,
    private readonly sync: SyncPayout,
  ) {}

  async execute({
    payoutId,
    adminUserId,
    now,
  }: {
    payoutId: string;
    adminUserId: string;
    now: Date;
  }): Promise<PayoutSyncResult> {
    const payout = await this.transaction.run(() => this.ledger.lock({ payoutId }));
    if (!payout) throw new PayoutNotFoundError();
    if (payout.status !== 'processing')
      throw new PayoutStatusConflictError(payout.status, 'processing');
    const transfer = await this.gateway.getPixTransfer({ externalReference: payout.externalRef });
    const result = transfer ? await this.sync.execute({ payoutId, transfer, now }) : 'pending';
    // Quem tentou e o que a consulta achou (Backoffice - cobrança RN01; D19).
    await this.transaction.run(() =>
      this.ledger.recordRetry({
        payoutId,
        adminUserId,
        gatewayStatus: transfer?.status ?? 'not_found',
        result,
        now,
      }),
    );
    if (!transfer) await this.queue.enqueue({ payoutId });
    return result;
  }
}

/**
 * A conciliação dos repasses em processamento (Repasse, casos de borda;
 * decisão 230, risco 5), na rodada diária: consulta cada um e aplica. O não
 * encontrado fica em processamento, com o alerta (B7-2).
 */
@Injectable()
export class ReconcilePayouts {
  constructor(
    private readonly transaction: BackofficeTransaction,
    @Inject(PAYOUT_LEDGER) private readonly ledger: PayoutLedger,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly sync: SyncPayout,
  ) {}

  async execute({
    now,
    payoutId: only,
  }: {
    now: Date;
    payoutId?: string;
  }): Promise<Record<PayoutSyncResult, number>> {
    const tally: Record<PayoutSyncResult, number> = {
      paid: 0,
      failed: 0,
      pending: 0,
      unchanged: 0,
      not_found: 0,
    };
    const ids = await this.transaction.run(() =>
      this.ledger.processingPayoutIds({ payoutId: only }),
    );
    for (const payoutId of ids) {
      try {
        const payout = await this.transaction.run(() => this.ledger.lock({ payoutId }));
        if (!payout) continue;
        const transfer = await this.gateway.getPixTransfer({
          externalReference: payout.externalRef,
        });
        if (!transfer) {
          await this.transaction.run(async () => {
            await this.ledger.markStuck({ payoutId, error: 'transfer_not_found', now });
            await this.ledger.openFailedAlert({ payoutId, reason: 'transfer_not_found' });
          });
          tally.pending++;
          continue;
        }
        tally[await this.sync.execute({ payoutId, transfer, now })]++;
      } catch (error) {
        logger.warn(`Conciliação do repasse falhou (${(error as Error).name}).`);
      }
    }
    return tally;
  }
}
