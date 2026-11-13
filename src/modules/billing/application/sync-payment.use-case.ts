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
import { REFUND_QUEUE, type RefundQueue } from './ports/refund-queue.port';
import { afterRefundFailure } from '../domain/refund-attempts';
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
  | 'refunded'
  | 'refund_failed'
  | 'refund_given_up'
  | 'disputed'
  | 'dispute_open'
  | 'dispute_won'
  | 'dispute_lost'
  | 'not_handled';

/**
 * Por que o pendente foi cancelado (RN07 e RN11). Sem motivo (o gateway
 * cancelou sozinho), o Pix com o vencimento passado conta como vencido.
 */
export type CancelReason =
  | 'pix_expired'
  | 'replaced'
  | 'no_gateway_charge'
  | 'publication_refunded'
  | 'end_date_changed'
  | 'wedding_blocked';

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
 * - estornado (Pagamentos e arrependimento RN03 e RN07): refund_requested →
 *   refunded, com o aviso "Reembolso concluído" (central e e-mail);
 * - estorno recusado (RN05): a tentativa falha; de novo em 1 h, 6 h e 24 h, e
 *   depois da 4ª o pagamento fica em refund_requested com o alerta;
 * - o pago sem destino vira estorno automático (Publicar e pagar RN08);
 * - contestação (RN06; RN10 de Publicar e pagar): `paid → disputed` com o
 *   prazo e o alerta `payment_disputed`; com o estorno já pedido, só a data e o
 *   alerta; depois do estorno, só o alerta. Ganha, volta a `paid`; perdida,
 *   `refunded` com origem `chargeback` e o alerta `dispute_lost`, **sem
 *   cascata**: as extensões e o casamento não mudam (B3-4). O casamento
 *   apagado (lápide) não muda em nenhum caso (B3-8).
 *
 * Aplicar a extensão (Data de saída do ar RN04): a nova data, a carência e o
 * expirado de volta, o log `wedding.extended` e os mesmos avisos do pagamento.
 *
 * Aplicar a publicação: o Payment pago com appliedAt; o casamento publicado
 * até a data paga (paidThrough = endDate, origem payment); os logs; a
 * notificação `billing` às pessoas donas e, na primeira publicação, o
 * `wedding_published` ao indicador; depois do commit, o push e o e-mail (que
 * sempre sai, decisão 236) e o evento de produto `publicado`. A comissão nasce
 * aqui, na mesma transação (Comissões do indicador RN01).
 */
@Injectable()
export class SyncPaymentWithGateway {
  constructor(
    private readonly transaction: BackofficeTransaction,
    @Inject(PAYMENT_LEDGER) private readonly ledger: PaymentLedger,
    @Inject(BILLING_MAILER) private readonly mailer: BillingMailer,
    @Inject(BILLING_PUSH) private readonly push: BillingPush,
    @Inject(REFUND_QUEUE) private readonly refunds: RefundQueue,
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
        case 'refunded':
          // O mesmo estorno de novo não faz nada; o pago que o gateway diz
          // estornado sem pedido é diferença (a reconciliação diária alerta).
          if (payment.status === 'refunded') return 'unchanged';
          if (payment.status !== 'refund_requested') return 'not_handled';
          await this.refunded({ wedding, payment, now });
          return 'refunded';
        case 'refund_failed':
          if (payment.status !== 'refund_requested' || payment.refundFailedAt) return 'unchanged';
          return this.refundFailure({
            wedding,
            payment,
            error: charge.failureReason ?? 'refund_failed',
            now,
          });
        case 'disputed':
          return this.disputed({ wedding, payment, charge, now });
        case 'dispute_lost':
          return this.disputeLost({ wedding, payment, now });
        case 'confirmed':
          if (payment.status === 'disputed') return this.disputeWon({ wedding, payment, now });
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
        // RN08: fica pago sem appliedAt e vira estorno automático, pela porta
        // depois do commit (Pagamentos e arrependimento RN04).
        await this.ledger.requestAutomaticRefund({ paymentId, now });
        await this.ledger.log({
          entry: {
            action: 'payment.refund_requested',
            weddingId: wedding.id,
            entityType: 'payment',
            entityId: paymentId,
            data: { refundOrigin: 'automatic', amountCents: chargedCents },
          },
        });
        this.transaction.schedule(() =>
          this.refunds.enqueue({ paymentId, attempt: 1, delayMs: 0 }),
        );
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
   * A chamada de estorno à porta não teve resposta (Pagamentos e arrependimento
   * RN05): a tentativa conta como falha, como a recusa que chega pelo webhook.
   */
  refundCallFailed({
    paymentId,
    error,
    now,
  }: {
    paymentId: string;
    error: string;
    now: Date;
  }): Promise<SyncResult> {
    return this.transaction.run(async () => {
      const locked = await this.ledger.lock({ paymentId });
      if (!locked) return 'no_payment';
      const { wedding, payment } = locked;
      if (payment.status !== 'refund_requested' || payment.refundFailedAt) return 'unchanged';
      return this.refundFailure({ wedding, payment, error, now });
    });
  }

  /** A contestação aberta (RN06; Publicar e pagar RN10). */
  private async disputed({
    wedding,
    payment,
    charge,
    now,
  }: {
    wedding: LedgerWedding;
    payment: LedgerPayment;
    charge: GatewayCharge;
    now: Date;
  }): Promise<SyncResult> {
    const alert = {
      type: 'payment_disputed' as const,
      weddingId: wedding.id,
      entityType: 'payment',
      entityId: payment.id,
      data: {
        shortCode: payment.shortCode,
        disputeDeadline: charge.disputeDeadline,
        paymentStatus: payment.status,
      },
    };
    if (payment.status === 'refunded') {
      // Depois do estorno, só o alerta: o dinheiro já voltou.
      await this.ledger.openAlert(alert);
      return 'disputed';
    }
    // O mesmo fato de novo não faz nada (a contestação continua aberta). Uma
    // contestação nova depois da ganha (pré-arbitragem) abre de novo.
    const open =
      payment.status === 'disputed' ||
      (payment.disputedAt !== null && payment.disputeResolvedAt === null);
    if (open) return 'dispute_open';
    if (payment.status !== 'paid' && payment.status !== 'refund_requested') return 'unchanged';
    await this.ledger.markDisputed({
      paymentId: payment.id,
      now,
      deadline: charge.disputeDeadline,
      keepStatus: payment.status === 'refund_requested',
    });
    await this.ledger.log({
      entry: {
        action: 'payment.disputed',
        weddingId: wedding.id,
        entityType: 'payment',
        entityId: payment.id,
        data: { amountCents: payment.amountCents, disputeDeadline: charge.disputeDeadline },
      },
    });
    // Comissões RN06: a comissão pending ou available fica retida.
    await this.ledger.holdCommission({ paymentId: payment.id, now });
    await this.ledger.openAlert(alert);
    return 'disputed';
  }

  /** Contestação ganha (RN06): volta a `paid`; a comissão volta a seguir o prazo. */
  private async disputeWon({
    wedding,
    payment,
    now,
  }: {
    wedding: LedgerWedding;
    payment: LedgerPayment;
    now: Date;
  }): Promise<SyncResult> {
    await this.ledger.markDisputeWon({ paymentId: payment.id, now });
    // Comissões RN06: volta a seguir o prazo.
    await this.ledger.releaseCommission({ paymentId: payment.id, now });
    await this.ledger.log({
      entry: {
        action: 'payment.dispute_won',
        weddingId: wedding.id,
        entityType: 'payment',
        entityId: payment.id,
        data: { amountCents: payment.amountCents },
      },
    });
    return 'dispute_won';
  }

  /**
   * Contestação perdida (RN06; B3-4): só o pagamento contestado vira
   * `refunded`; as extensões por cima continuam pagas e o casamento segue no
   * ar até a endDate. O alerta `dispute_lost` deixa o Admin decidir.
   */
  private async disputeLost({
    wedding,
    payment,
    now,
  }: {
    wedding: LedgerWedding;
    payment: LedgerPayment;
    now: Date;
  }): Promise<SyncResult> {
    // Também do `paid`: a abertura pode não ter chegado (a consulta é a fonte).
    if (!['disputed', 'refund_requested', 'paid'].includes(payment.status)) return 'unchanged';
    await this.ledger.markDisputeLost({ paymentId: payment.id, now });
    // Comissões RN05 e RN06: só a do pagamento contestado.
    await this.ledger.reverseCommission({ paymentId: payment.id, now });
    await this.ledger.log({
      entry: {
        action: 'payment.dispute_lost',
        weddingId: wedding.id,
        entityType: 'payment',
        entityId: payment.id,
        data: { amountCents: payment.amountCents, previousStatus: payment.status },
      },
    });
    await this.ledger.openAlert({
      type: 'dispute_lost',
      weddingId: wedding.id,
      entityType: 'payment',
      entityId: payment.id,
      data: { shortCode: payment.shortCode, kind: payment.kind, weddingStatus: wedding.status },
    });
    return 'dispute_lost';
  }

  /** O gateway estornou (RN03 e RN07): refunded, o log e o "Reembolso concluído". */
  private async refunded({
    wedding,
    payment,
    now,
  }: {
    wedding: LedgerWedding;
    payment: LedgerPayment;
    now: Date;
  }): Promise<void> {
    await this.ledger.markRefunded({ paymentId: payment.id, now });
    await this.ledger.log({
      entry: {
        action: 'payment.refunded',
        weddingId: wedding.id,
        entityType: 'payment',
        entityId: payment.id,
        data: { refundOrigin: payment.refundOrigin, amountCents: payment.amountCents },
      },
    });
    // Comissões RN05: a comissão vira reversed (dentro de um repasse: o PR do repasse).
    await this.ledger.reverseCommission({ paymentId: payment.id, now });
    const recipients = await this.ledger.billingRecipients({ weddingId: wedding.id });
    await this.ledger.notifyBilling({
      weddingId: wedding.id,
      paymentId: payment.id,
      event: 'refund_completed',
      userIds: recipients.map((recipient) => recipient.userId),
      payload: {
        kind: 'refund_completed',
        paymentId: payment.id,
        amountCents: payment.amountCents,
        method: payment.method,
        installments: payment.installments,
        cardLast4: payment.method === 'card' ? payment.cardLast4 : null,
        at: now.toISOString(),
      },
      now,
    });
    const partnerNames = await this.ledger.partnerNames({ weddingId: wedding.id });
    for (const recipient of recipients) {
      this.transaction.schedule(() =>
        this.mailer.refundCompleted({
          notice: { to: recipient.email, firstName: recipient.firstName, partnerNames },
        }),
      );
    }
  }

  /**
   * A tentativa de estorno falhou (RN05): de novo em 1 h, 6 h e 24 h; depois da
   * 4ª chamada, o pagamento fica em refund_requested (nunca volta a paid), com
   * o refundFailedAt e o alerta `refund_failed`, que cita o pedido todo (B3-3).
   */
  private async refundFailure({
    wedding,
    payment,
    error,
    now,
  }: {
    wedding: LedgerWedding;
    payment: LedgerPayment;
    error: string;
    now: Date;
  }): Promise<SyncResult> {
    // Uma falha por tentativa: o mesmo evento processado de novo (em linha e
    // pela fila, ou repetido pelo gateway) não conta outra vez.
    if (payment.refundLastError !== null) return 'unchanged';
    const attempts = Math.max(1, payment.refundAttempts);
    const decision = afterRefundFailure({ attempts });
    const gaveUp = decision.kind === 'give_up';
    await this.ledger.recordRefundFailure({ paymentId: payment.id, error, gaveUp, now });
    await this.ledger.log({
      entry: {
        action: 'payment.refund_failed',
        weddingId: wedding.id,
        entityType: 'payment',
        entityId: payment.id,
        data: { attempt: attempts, error, gaveUp, refundOrigin: payment.refundOrigin },
      },
    });
    if (decision.kind === 'retry') {
      this.transaction.schedule(() =>
        this.refunds.enqueue({
          paymentId: payment.id,
          attempt: decision.attempt,
          delayMs: decision.delayMs,
        }),
      );
      return 'refund_failed';
    }
    const request = payment.refundRequestedAt
      ? await this.ledger.sameRefundRequest({
          weddingId: wedding.id,
          refundRequestedAt: payment.refundRequestedAt,
        })
      : [];
    await this.ledger.openAlert({
      type: 'refund_failed',
      weddingId: wedding.id,
      entityType: 'payment',
      entityId: payment.id,
      data: {
        shortCode: payment.shortCode,
        attempts,
        error,
        refundOrigin: payment.refundOrigin,
        sameRequest: request.map((row) => row.shortCode),
      },
    });
    return 'refund_given_up';
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
    const firstPublication = payment.kind === 'publication' && wedding.publishedAt === null;
    await this.ledger.markApplied({ paymentId: payment.id, now });
    // Comissões RN01: na mesma transação que aplica o pagamento.
    await this.ledger.createCommission({ weddingId: wedding.id, paymentId: payment.id, now });
    if (payment.kind === 'extension') {
      // Data de saída do ar RN04: a nova data; a carência e o expirado voltam.
      await this.ledger.extend({
        weddingId: wedding.id,
        paymentId: payment.id,
        endDate: payment.periodEnd,
        now,
      });
      await this.ledger.log({
        entry: {
          action: 'wedding.extended',
          weddingId: wedding.id,
          entityType: 'wedding',
          entityId: wedding.id,
          data: {
            paymentId: payment.id,
            from: wedding.endDate,
            to: payment.periodEnd,
            previousStatus: wedding.status,
          },
        },
      });
    } else {
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
    }
    const recipients = await this.ledger.billingRecipients({ weddingId: wedding.id });
    await this.ledger.notifyBilling({
      weddingId: wedding.id,
      paymentId: payment.id,
      event: 'payment_confirmed',
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
