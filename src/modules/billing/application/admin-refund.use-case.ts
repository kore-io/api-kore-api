import { Inject, Injectable, Logger } from '@nestjs/common';
import { BackofficeTransaction } from '../../../shared/database/backoffice-transaction';
import { uuidV7 } from '../../../shared/ids/uuid-v7';
import {
  PaymentDisputedError,
  PaymentNotFoundError,
  PaymentNotPaidError,
  RefundAlreadyRequestedError,
  RefundNotLastExtensionError,
} from '../domain/billing.errors';
import { CancelPendingPayment } from './cancel-pending-payment';
import { REFUND_QUEUE, type RefundQueue } from './ports/refund-queue.port';

const logger = new Logger('AdminRefund');

/**
 * Reembolsar pelo Admin (Backoffice - cobrança RN05; decisões 72 e 126):
 * sempre integral, a qualquer momento (o prazo de 7 dias é só do casal), com
 * as regras e os efeitos de Pagamentos e arrependimento RN03 a RN05 pela
 * `apply_payment_refund` (a publicação leva as extensões, o site volta a
 * rascunho, a extensão volta a data, a comissão fica retida, o 2º reembolso de
 * publicação abre o alerta). O motivo vai ao log, não ao `refundReason` (é do
 * casal). Depois do commit, os estornos por job e o Pix de extensão pendente
 * cancelado (G1).
 */
@Injectable()
export class AdminRefund {
  constructor(
    private readonly transaction: BackofficeTransaction,
    @Inject(REFUND_QUEUE) private readonly refunds: RefundQueue,
    private readonly cancelPending: CancelPendingPayment,
  ) {}

  async execute({
    paymentId,
    adminUserId,
    reason,
    now,
  }: {
    paymentId: string;
    adminUserId: string;
    reason: string | null;
    now: Date;
  }): Promise<{ refundsPaymentIds: string[] }> {
    const { ids, pendingExtensionId } = await this.transaction.run(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { id: paymentId },
        select: { weddingId: true, kind: true },
      });
      if (!payment) throw new PaymentNotFoundError();
      const [row] = await tx.$queryRaw<{ result: string; payment_ids: string[] }[]>`
        SELECT result, payment_ids::text[] AS payment_ids FROM apply_payment_refund(
          ${payment.weddingId}::uuid, ${paymentId}::uuid, NULL, ${now}::timestamptz,
          ${uuidV7({ now: now.getTime() })}::uuid, 'admin'::refund_origin,
          ${adminUserId}::uuid, false)`;
      switch (row?.result) {
        case 'requested':
          break;
        case 'already_requested':
          throw new RefundAlreadyRequestedError();
        case 'disputed':
          throw new PaymentDisputedError();
        case 'not_paid':
          throw new PaymentNotPaidError();
        case 'not_last_extension':
          throw new RefundNotLastExtensionError();
        default:
          throw new PaymentNotFoundError();
      }
      const rows = await tx.payment.findMany({
        where: { id: { in: row.payment_ids } },
        select: { id: true, kind: true, amountCents: true },
      });
      await tx.applicationLog.createMany({
        data: rows.map((item) => ({
          createdAt: now,
          action: 'payment.refund_requested',
          actorKind: 'admin' as const,
          actorUserId: adminUserId,
          weddingId: payment.weddingId,
          entityType: 'payment',
          entityId: item.id,
          data: {
            refundOrigin: 'admin',
            kind: item.kind,
            amountCents: item.amountCents,
            requestedPaymentId: paymentId,
            ...(reason ? { reason } : {}),
          },
        })),
      });
      const pending =
        payment.kind === 'publication'
          ? await tx.payment.findFirst({
              where: { weddingId: payment.weddingId, kind: 'extension', status: 'pending' },
              select: { id: true },
            })
          : null;
      return { ids: row.payment_ids, pendingExtensionId: pending?.id ?? null };
    });

    // Depois do commit (G1). Sem a fila, a reconciliação repõe o estorno.
    for (const id of ids) {
      try {
        await this.refunds.enqueue({ paymentId: id, attempt: 1, delayMs: 0 });
      } catch (error) {
        logger.warn(`Estorno de ${id} fora da fila: ${(error as Error).name}`);
      }
    }
    if (pendingExtensionId) {
      try {
        await this.cancelPending.execute({
          paymentId: pendingExtensionId,
          reason: 'publication_refunded',
          now,
        });
      } catch (error) {
        logger.warn(
          `Pix de extensão ${pendingExtensionId} não cancelado: ${(error as Error).name}`,
        );
      }
    }
    return { refundsPaymentIds: ids };
  }
}
