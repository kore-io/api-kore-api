import { Inject, Injectable, Logger } from '@nestjs/common';
import { BackofficeTransaction } from '../../../shared/database/backoffice-transaction';
import {
  type GatewayCharge,
  PAYMENT_GATEWAY,
  type PaymentGateway,
} from './ports/payment-gateway.port';
import { PAYMENT_LEDGER, type PaymentLedger } from './ports/payment-ledger.port';
import { REFUND_QUEUE, type RefundQueue } from './ports/refund-queue.port';
import {
  PAYMENT_RECONCILIATION_READER,
  type PaymentReconciliationReader,
  type ReconcilingPayment,
} from './ports/payment-reconciliation.reader.port';
import { type SyncResult, SyncPaymentWithGateway } from './sync-payment.use-case';

const logger = new Logger('PaymentReconciliation');

/** Só os pendentes com mais de 5 minutos: o pedido em curso ainda está nos passos da RN03. */
export const PENDING_STALE_AFTER_MS = 5 * 60_000;
/** O Pix vale 24 horas (decisão 41): o vencimento do pendente sem o passo 3. */
const PIX_VALIDITY_MS = 24 * 60 * 60_000;
/** A lista do gateway: as últimas 48 h, com folga sobre a rodada diária anterior. */
export const GATEWAY_LIST_WINDOW_MS = 48 * 60 * 60_000;
const BATCH = 200;
/**
 * O estorno que o gateway aceitou e não concluiu em 7 dias vira alerta (a
 * sugestão do Crivo no PR 5a): sem ele, a diária só vê a cobrança confirmada.
 */
export const REFUND_STALE_AFTER_MS = 7 * 24 * 60 * 60_000;

/** O que uma rodada fez, para o log do job. */
export interface ReconciliationTally {
  checked: number;
  changed: number;
  alerts: number;
  errors: number;
}

/** Os resultados que a reconciliação não resolve num pagamento já pago (RN11). */
const UNRESOLVED: SyncResult[] = ['unchanged', 'not_handled', 'no_payment'];

/**
 * A reconciliação (Publicar e pagar RN11; decisão 231, rec. 16 e B2-8). Corrige
 * pelo mesmo caminho do webhook: consulta a cobrança pela porta, fora de
 * transação (RN19), e aplica o estado pelo SyncPaymentWithGateway. Uma falha
 * num pagamento não para a rodada: ele volta na próxima.
 *
 * - `pending` (a cada 10 minutos): os pendentes com mais de 5 minutos,
 *   inclusive os sem id do gateway, pela referência. Sem cobrança no gateway,
 *   o pendente vira `canceled` (o pedido caiu entre os passos 1 e 2). O Pix
 *   vencido é consultado antes de cancelar: pago, aplica; senão, cancela no
 *   gateway e passa a `canceled`, com o e-mail "O código Pix venceu".
 *   Também repõe na fila o estorno pedido que nunca tentou (RN04).
 * - `settled` e `gatewayList` (às 4h): os `paid`, `refund_requested` e
 *   `disputed`, e a lista das cobranças do gateway nas últimas 48 h, com
 *   `Alert` para a cobrança sem `Payment` e para a confirmação que chegou a um
 *   `Payment` cancelado ou recusado sem o webhook. A diferença que não se
 *   resolve vira o `Alert` `webhook_failure`, como o estorno pedido há mais de
 *   7 dias que o gateway ainda não fez.
 */
@Injectable()
export class ReconcilePayments {
  constructor(
    @Inject(PAYMENT_RECONCILIATION_READER) private readonly payments: PaymentReconciliationReader,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(PAYMENT_LEDGER) private readonly ledger: PaymentLedger,
    private readonly transaction: BackofficeTransaction,
    private readonly sync: SyncPaymentWithGateway,
    @Inject(REFUND_QUEUE) private readonly refunds: RefundQueue,
  ) {}

  /** A rodada de 10 minutos. */
  async pending({
    now,
    weddingId,
  }: {
    now: Date;
    weddingId?: string;
  }): Promise<ReconciliationTally> {
    const tally = emptyTally();
    const stale = await this.payments.stalePending({
      createdBefore: new Date(now.getTime() - PENDING_STALE_AFTER_MS),
      weddingId,
      limit: BATCH * 5,
    });
    for (const payment of stale) {
      tally.checked++;
      await this.guarded(tally, payment.id, async () => {
        const result = await this.reconcilePending({ payment, now });
        if (result !== 'unchanged') tally.changed++;
      });
    }
    // O estorno pedido que não entrou na fila (Pagamentos e arrependimento
    // RN04): volta como a 1ª tentativa; o id fixo do job não duplica.
    const refunds = await this.payments.refundsNeverAttempted({
      requestedBefore: new Date(now.getTime() - PENDING_STALE_AFTER_MS),
      weddingId,
      limit: BATCH,
    });
    for (const refund of refunds) {
      tally.checked++;
      await this.guarded(tally, refund.id, async () => {
        await this.refunds.enqueue({ paymentId: refund.id, attempt: 1, delayMs: 0 });
        tally.changed++;
      });
    }
    return tally;
  }

  /** A rodada diária: os pagos e a lista do gateway. */
  async daily({ now }: { now: Date }): Promise<ReconciliationTally> {
    const settled = await this.settled({ now });
    const listed = await this.gatewayList({ now });
    return {
      checked: settled.checked + listed.checked,
      changed: settled.changed + listed.changed,
      alerts: settled.alerts + listed.alerts,
      errors: settled.errors + listed.errors,
    };
  }

  /** Os `paid`, `refund_requested` e `disputed`: o gateway ainda diz o mesmo? */
  async settled({
    now,
    weddingId,
  }: {
    now: Date;
    weddingId?: string;
  }): Promise<ReconciliationTally> {
    const tally = emptyTally();
    let afterId: string | null = null;
    for (;;) {
      const page = await this.payments.settled({ afterId, weddingId, limit: BATCH });
      for (const payment of page) {
        tally.checked++;
        await this.guarded(tally, payment.id, async () => {
          const charge = await this.gateway.getCharge({ externalReference: payment.id });
          if (!charge) {
            await this.alert(tally, payment, {
              reason: 'charge_not_found',
              paymentStatus: payment.status,
            });
            return;
          }
          const result = await this.sync.execute({ paymentId: payment.id, charge, now });
          // O estorno recusado segue o fluxo do estorno (RN05), que já alerta.
          const refundFlow =
            payment.status === 'refund_requested' && charge.status === 'refund_failed';
          if (UNRESOLVED.includes(result) && !refundFlow) {
            await this.alert(tally, payment, {
              reason: 'state_mismatch',
              paymentStatus: payment.status,
              gatewayStatus: charge.status,
            });
          } else if (result !== 'already_confirmed' && result !== 'dispute_open' && !refundFlow)
            tally.changed++;
          else if (refundStuck({ payment, now })) {
            // Pagamentos e arrependimento RN05: o estorno pedido e nunca concluído.
            await this.alert(tally, payment, {
              reason: 'refund_not_concluded',
              paymentStatus: payment.status,
              gatewayStatus: charge.status,
              refundRequestedAt: payment.refundRequestedAt?.toISOString() ?? null,
            });
          }
        });
      }
      if (page.length < BATCH) break;
      afterId = page[page.length - 1].id;
    }
    return tally;
  }

  /**
   * A lista das cobranças do gateway (B2-8): a cobrança sem `Payment` abre o
   * alerta; a confirmada cujo `Payment` está cancelado ou recusado passa pelo
   * mesmo caminho do webhook (vira pagamento sem destino, RN08). Os pendentes
   * ficam com a rodada de 10 minutos, e os pagos, com `settled`.
   */
  async gatewayList({ now }: { now: Date }): Promise<ReconciliationTally> {
    const tally = emptyTally();
    const charges = await this.gateway.listCharges({
      from: new Date(now.getTime() - GATEWAY_LIST_WINDOW_MS),
      to: now,
    });
    const known = new Map(
      (
        await this.payments.byReferences({
          references: charges.map((charge) => charge.externalReference),
        })
      ).map((payment) => [payment.id, payment]),
    );
    for (const charge of charges) {
      tally.checked++;
      const payment = known.get(charge.externalReference);
      if (!payment) {
        await this.guarded(tally, charge.gatewayPaymentId, () =>
          this.unknownChargeAlert(tally, charge),
        );
        continue;
      }
      if (charge.status !== 'confirmed' || !['canceled', 'failed'].includes(payment.status))
        continue;
      await this.guarded(tally, payment.id, async () => {
        const result = await this.sync.execute({ paymentId: payment.id, charge, now });
        if (result !== 'unchanged') tally.changed++;
      });
    }
    return tally;
  }

  private async reconcilePending({
    payment,
    now,
  }: {
    payment: ReconcilingPayment;
    now: Date;
  }): Promise<SyncResult> {
    let charge = await this.gateway.getCharge({ externalReference: payment.id });
    if (!charge) return this.sync.cancelWithoutCharge({ paymentId: payment.id, now });
    const waiting = charge.status === 'pending' || charge.status === 'overdue';
    if (!waiting || !pixExpired({ payment, now }))
      return this.sync.execute({ paymentId: payment.id, charge, now });

    // Pix vencido e não pago na consulta: cancela no gateway e aplica o que ele diz depois.
    await this.gateway.cancelCharge({ gatewayPaymentId: charge.gatewayPaymentId });
    charge = await this.gateway.getCharge({ externalReference: payment.id });
    if (!charge) return 'unchanged';
    return this.sync.execute({ paymentId: payment.id, charge, now, cancelReason: 'pix_expired' });
  }

  private async alert(
    tally: ReconciliationTally,
    payment: ReconcilingPayment,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.transaction.run(() =>
      this.ledger.openAlert({
        type: 'webhook_failure',
        weddingId: payment.weddingId,
        entityType: 'payment',
        entityId: payment.id,
        data,
      }),
    );
    tally.alerts++;
  }

  private async unknownChargeAlert(tally: ReconciliationTally, charge: GatewayCharge) {
    await this.transaction.run(() =>
      this.ledger.openAlert({
        type: 'webhook_failure',
        weddingId: null,
        entityType: 'gateway_charge',
        entityId: charge.gatewayPaymentId,
        data: {
          reason: 'charge_without_payment',
          externalReference: charge.externalReference,
          gatewayStatus: charge.status,
          chargedCents: charge.chargedCents,
        },
      }),
    );
    tally.alerts++;
  }

  private async guarded(
    tally: ReconciliationTally,
    id: string,
    work: () => Promise<void>,
  ): Promise<void> {
    try {
      await work();
    } catch (error) {
      tally.errors++;
      logger.warn(`Reconciliação de ${id} falhou: ${(error as Error).name}`);
    }
  }
}

function emptyTally(): ReconciliationTally {
  return { checked: 0, changed: 0, alerts: 0, errors: 0 };
}

/** O Pix venceu? Sem o passo 3 da RN03, o vencimento conta da criação. */
function pixExpired({ payment, now }: { payment: ReconcilingPayment; now: Date }): boolean {
  if (payment.method !== 'pix') return false;
  const dueAt = payment.dueAt ?? new Date(payment.createdAt.getTime() + PIX_VALIDITY_MS);
  return dueAt.getTime() <= now.getTime();
}

/** O estorno pedido há mais de 7 dias, sem desistência registrada, que o gateway ainda não fez. */
function refundStuck({ payment, now }: { payment: ReconcilingPayment; now: Date }): boolean {
  return (
    payment.status === 'refund_requested' &&
    payment.refundFailedAt === null &&
    payment.refundRequestedAt !== null &&
    now.getTime() - payment.refundRequestedAt.getTime() > REFUND_STALE_AFTER_MS
  );
}
