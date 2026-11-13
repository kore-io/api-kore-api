import { Inject, Injectable } from '@nestjs/common';
import { BackofficeTransaction } from '../../../shared/database/backoffice-transaction';
import { daysBetween, localDate } from '../../../shared/time/local-date';
import {
  PRODUCT_EVENT_RECORDER,
  type ProductEventRecorder,
} from '../../product-events/application/ports/product-event-recorder.port';
import { decideConfirmation } from '../domain/payment-confirmation';
import { BILLING_MAILER, type BillingMailer } from './ports/billing-mailer.port';
import { BILLING_PUSH, type BillingPush } from './ports/billing-push.port';
import type { GatewayCharge } from './ports/payment-gateway.port';
import {
  type LedgerPayment,
  type LedgerWedding,
  PAYMENT_LEDGER,
  type PaymentLedger,
} from './ports/payment-ledger.port';

export type SyncResult =
  | 'no_payment'
  | 'unchanged'
  | 'failed'
  | 'canceled'
  | 'already_confirmed'
  | 'applied'
  | 'undercharged'
  | 'orphan'
  | 'not_handled';

/**
 * Por que o pendente foi cancelado (RN07 e RN11). Sem motivo (o gateway
 * cancelou sozinho), o Pix com o vencimento passado conta como vencido.
 */
export type CancelReason = 'pix_expired' | 'replaced' | 'no_gateway_charge';

/**
 * Aplica ao Payment o estado que o gateway devolveu na consulta (Publicar e
 * pagar RN09: o webhook é gatilho, a consulta é a fonte), pela máquina de
 * estados da RN10, numa transação do backoffice com o Wedding travado antes do
 * Payment (RN18). Serve ao webhook e à reconciliação (RN11).
 *
 * - confirmado: decide entre aplicar (RN05), recebido a menos (RN09) e sem
 *   destino (RN08); o mesmo fato de novo não faz nada;
 * - recusado e cancelado: pendente → failed · canceled; o Pix vencido manda o
 *   e-mail "O código Pix venceu" às pessoas donas, depois do commit (RN11);
 * - estorno e disputa: o PR de Pagamentos e arrependimento.
 *
 * Aplicar a publicação: o Payment pago com appliedAt; o casamento publicado
 * até a data paga (paidThrough = endDate, origem payment); os logs; a
 * notificação `billing` às pessoas donas e, na primeira publicação, o
 * `wedding_published` ao indicador; depois do commit, o push e o e-mail (que
 * sempre sai, decisão 236) e o evento de produto `publicado`. A comissão nasce aqui, no PR das comissões.
 */
@Injectable()
export class SyncPaymentWithGateway {
  constructor(
    private readonly transaction: BackofficeTransaction,
    @Inject(PAYMENT_LEDGER) private readonly ledger: PaymentLedger,
    @Inject(BILLING_MAILER) private readonly mailer: BillingMailer,
    @Inject(BILLING_PUSH) private readonly push: BillingPush,
    @Inject(PRODUCT_EVENT_RECORDER) private readonly productEvents: ProductEventRecorder,
  ) {}

  execute({
    paymentId,
    charge,
    now,
    cancelReason,
  }: {
    paymentId: string;
    charge: GatewayCharge;
    now: Date;
    cancelReason?: CancelReason;
  }): Promise<SyncResult> {
    return this.transaction.run(async () => {
      const locked = await this.ledger.lock({ paymentId });
      if (!locked) return 'no_payment';
      const { wedding, payment } = locked;

      switch (charge.status) {
        case 'pending':
        case 'overdue':
          return 'unchanged';
        case 'refused':
          if (payment.status !== 'pending') return 'unchanged';
          await this.ledger.markFailed({
            paymentId,
            reason: charge.failureReason ?? 'refused',
            gatewayPaymentId: charge.gatewayPaymentId,
          });
          await this.ledger.log({
            entry: {
              action: 'payment.failed',
              weddingId: wedding.id,
              entityType: 'payment',
              entityId: paymentId,
              data: { reason: charge.failureReason ?? 'refused' },
            },
          });
          return 'failed';
        case 'canceled':
          if (payment.status !== 'pending') return 'unchanged';
          await this.cancel({ wedding, payment, now, reason: cancelReason ?? null });
          return 'canceled';
        case 'confirmed':
          break;
        default:
          return 'not_handled';
      }

      const chargedCents = charge.chargedCents ?? payment.amountCents;
      const decision = decideConfirmation({
        payment,
        wedding,
        chargedCents,
        otherPublicationApplied:
          payment.kind === 'publication' &&
          (await this.ledger.otherPublicationApplied({ weddingId: wedding.id, paymentId })),
      });
      if (decision.kind === 'already_confirmed') return 'already_confirmed';
      if (payment.kind === 'extension') return 'not_handled';

      await this.ledger.markPaid({
        paymentId,
        paidAt: now,
        chargedCents,
        feeCents: charge.feeCents,
        netCents: charge.netCents,
        gatewayPaymentId: charge.gatewayPaymentId,
        cardLast4: charge.cardLast4,
      });
      await this.ledger.log({
        entry: {
          action: 'payment.paid',
          weddingId: wedding.id,
          entityType: 'payment',
          entityId: paymentId,
          data: {
            chargedCents,
            amountCents: payment.amountCents,
            applied: decision.kind === 'apply',
          },
        },
      });

      if (decision.kind === 'undercharged' || (decision.kind === 'apply' && decision.overcharged)) {
        await this.ledger.openAlert({
          type: 'gateway_amount_mismatch',
          weddingId: wedding.id,
          entityType: 'payment',
          entityId: paymentId,
          data: {
            shortCode: payment.shortCode,
            chargedCents,
            amountCents: payment.amountCents,
            applied: decision.kind === 'apply',
          },
        });
      }
      if (decision.kind === 'undercharged') return 'undercharged';
      if (decision.kind === 'orphan') {
        // RN08: fica pago sem appliedAt; o estorno automático entra no PR de
        // Pagamentos e arrependimento.
        await this.ledger.openAlert({
          type: 'orphan_payment',
          weddingId: wedding.id,
          entityType: 'payment',
          entityId: paymentId,
          data: { shortCode: payment.shortCode, reason: decision.reason },
        });
        return 'orphan';
      }

      await this.apply({ wedding, payment, now, cardLast4: charge.cardLast4 });
      return 'applied';
    });
  }

  /**
   * O pendente sem cobrança no gateway (RN11; casos de borda): o pedido caiu
   * entre o passo 1 e o passo 2 da RN03, e a consulta pela referência não acha
   * nada. Só o pendente sem o id do gateway; o resto não muda.
   */
  cancelWithoutCharge({ paymentId, now }: { paymentId: string; now: Date }): Promise<SyncResult> {
    return this.transaction.run(async () => {
      const locked = await this.ledger.lock({ paymentId });
      if (!locked) return 'no_payment';
      const { wedding, payment } = locked;
      if (payment.status !== 'pending' || payment.gatewayPaymentId) return 'unchanged';
      await this.cancel({ wedding, payment, now, reason: 'no_gateway_charge' });
      return 'canceled';
    });
  }

  private async cancel({
    wedding,
    payment,
    now,
    reason,
  }: {
    wedding: LedgerWedding;
    payment: LedgerPayment;
    now: Date;
    reason: CancelReason | null;
  }): Promise<void> {
    const expired =
      reason === 'pix_expired' ||
      (reason === null &&
        payment.method === 'pix' &&
        payment.dueAt !== null &&
        payment.dueAt.getTime() <= now.getTime());
    await this.ledger.markCanceled({ paymentId: payment.id, now });
    await this.ledger.log({
      entry: {
        action: 'payment.canceled',
        weddingId: wedding.id,
        entityType: 'payment',
        entityId: payment.id,
        data: { reason: expired ? 'pix_expired' : (reason ?? 'gateway') },
      },
    });
    // O e-mail fala da publicação; o Pix vencido da extensão entra com a extensão.
    if (!expired || payment.kind !== 'publication') return;
    const recipients = await this.ledger.billingRecipients({ weddingId: wedding.id });
    const partnerNames = await this.ledger.partnerNames({ weddingId: wedding.id });
    for (const recipient of recipients) {
      this.transaction.schedule(() =>
        this.mailer.pixExpired({ notice: { to: recipient.email, partnerNames } }),
      );
    }
  }

  private async apply({
    wedding,
    payment,
    now,
    cardLast4,
  }: {
    wedding: LedgerWedding;
    payment: LedgerPayment;
    now: Date;
    cardLast4: string | null;
  }): Promise<void> {
    const firstPublication = wedding.publishedAt === null;
    await this.ledger.markApplied({ paymentId: payment.id, now });
    await this.ledger.publish({
      weddingId: wedding.id,
      endDate: payment.periodEnd,
      publishedByUserId: payment.createdByUserId,
      now,
    });
    await this.ledger.log({
      entry: {
        action: 'wedding.published',
        weddingId: wedding.id,
        entityType: 'wedding',
        entityId: wedding.id,
        data: { paymentId: payment.id },
      },
    });
    const recipients = await this.ledger.billingRecipients({ weddingId: wedding.id });
    await this.ledger.notifyBilling({
      weddingId: wedding.id,
      paymentId: payment.id,
      userIds: recipients.map((recipient) => recipient.userId),
      payload: {
        kind: 'payment_confirmed',
        paymentId: payment.id,
        endDate: payment.periodEnd,
        amountCents: payment.amountCents,
        method: payment.method,
        installments: payment.installments,
        // O detalhe da central: "no cartão final 4821, 2x" (RN13).
        cardLast4: payment.method === 'card' ? cardLast4 : null,
        at: now.toISOString(),
      },
      now,
    });
    // Notificações da cerimonialista RN03: só na primeira publicação.
    if (firstPublication) await this.ledger.notifyWeddingPublished({ weddingId: wedding.id, now });

    // O push segue a preferência Push de cada pessoa (decisão 236); o worker confere.
    this.transaction.schedule(() =>
      this.push.paymentConfirmed({
        weddingId: wedding.id,
        userIds: recipients.map((recipient) => recipient.userId),
      }),
    );
    const partnerNames = await this.ledger.partnerNames({ weddingId: wedding.id });
    for (const recipient of recipients) {
      this.transaction.schedule(() =>
        this.mailer.paymentConfirmed({
          notice: {
            to: recipient.email,
            firstName: recipient.firstName,
            endDate: payment.periodEnd,
            partnerNames,
          },
        }),
      );
    }
    if (firstPublication && wedding.eventDate) {
      const daysUntilWedding = daysBetween({
        from: localDate({ at: now, timezone: wedding.timezone }),
        to: wedding.eventDate,
      });
      this.transaction.schedule(() =>
        this.productEvents.record({
          event: {
            name: 'publicado',
            weddingId: wedding.id,
            props: { dias_ate_casamento: daysUntilWedding },
          },
          occurredAt: now,
        }),
      );
    }
  }
}
