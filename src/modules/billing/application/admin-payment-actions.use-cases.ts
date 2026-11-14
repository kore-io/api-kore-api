import { Inject, Injectable } from '@nestjs/common';
import { BackofficeTransaction } from '../../../shared/database/backoffice-transaction';
import { PaymentNotFoundError, PaymentStateConflictError } from '../domain/billing.errors';
import { PAYMENT_LEDGER, type PaymentLedger } from './ports/payment-ledger.port';
import { REFUND_QUEUE, type RefundQueue } from './ports/refund-queue.port';
import { SyncPaymentWithGateway } from './sync-payment.use-case';

/**
 * As ações dos alertas de dinheiro (Backoffice - cobrança RN11; B10-3, B2-7 e
 * B3-1), só do Admin, com motivo e log.
 */
@Injectable()
export class AdminPaymentActions {
  constructor(
    private readonly transaction: BackofficeTransaction,
    @Inject(PAYMENT_LEDGER) private readonly ledger: PaymentLedger,
    @Inject(REFUND_QUEUE) private readonly refunds: RefundQueue,
    private readonly sync: SyncPaymentWithGateway,
  ) {}

  /** Aplicar mesmo assim (o `gateway_amount_mismatch`). */
  async applyAnyway(input: {
    paymentId: string;
    adminUserId: string;
    reason: string;
    now: Date;
  }): Promise<void> {
    const result = await this.sync.applyByAdmin(input);
    if (result === 'no_payment') throw new PaymentNotFoundError();
    if (result === 'not_applicable') throw new PaymentStateConflictError();
  }

  /**
   * Tentar o estorno de novo (o `refund_failed`): o pagamento continua em
   * refund_requested; a marca da desistência sai e o job, depois do commit,
   * consulta a cobrança antes de chamar a porta de novo (Pagamentos e arrependimento RN05).
   */
  retryRefund({
    paymentId,
    adminUserId,
    reason,
    now,
  }: {
    paymentId: string;
    adminUserId: string;
    reason: string;
    now: Date;
  }): Promise<void> {
    return this.transaction.run(async (tx) => {
      const locked = await this.ledger.lock({ paymentId });
      if (!locked) throw new PaymentNotFoundError();
      const { payment, wedding } = locked;
      if (payment.status !== 'refund_requested' || !payment.refundFailedAt)
        throw new PaymentStateConflictError();
      await tx.payment.update({
        where: { id: paymentId },
        data: { refundFailedAt: null, refundLastError: null },
      });
      await tx.applicationLog.create({
        data: {
          createdAt: now,
          action: 'payment.refund_retried',
          actorKind: 'admin',
          actorUserId: adminUserId,
          weddingId: wedding.id,
          entityType: 'payment',
          entityId: paymentId,
          data: { reason, attempt: payment.refundAttempts + 1 },
        },
      });
      this.transaction.schedule(() =>
        this.refunds.enqueue({ paymentId, attempt: payment.refundAttempts + 1, delayMs: 0 }),
      );
    });
  }

  /** Registrar reembolso feito por fora (o `refund_failed`), com o comprovante. */
  async recordManualRefund(input: {
    paymentId: string;
    adminUserId: string;
    reason: string;
    receipt: string;
    now: Date;
  }): Promise<void> {
    const result = await this.sync.recordManualRefund(input);
    if (result === 'no_payment') throw new PaymentNotFoundError();
    if (result === 'not_applicable') throw new PaymentStateConflictError();
  }
}
