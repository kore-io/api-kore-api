import { Inject, Injectable, Logger } from '@nestjs/common';
import { BackofficeTransaction } from '../../../shared/database/backoffice-transaction';
import {
  PaymentDisputedError,
  PaymentNotFoundError,
  PaymentNotPaidError,
  RefundAlreadyRequestedError,
  RefundNotLastExtensionError,
} from '../domain/billing.errors';
import { pastGatewayWindow } from '../domain/refund-receipt';
import { CancelPendingPayment } from './cancel-pending-payment';
import { ADMIN_BILLING_STORE, type AdminBillingStore } from './ports/admin-billing.store.port';
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
    @Inject(ADMIN_BILLING_STORE) private readonly store: AdminBillingStore,
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
  }): Promise<{ refundsPaymentIds: string[]; pastGatewayWindow: boolean }> {
    const outcome = await this.transaction.run(() =>
      this.store.requestRefund({ paymentId, adminUserId, reason, now }),
    );
    switch (outcome.result) {
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
    const ids = outcome.paymentIds;
    const pendingExtensionId = outcome.pendingExtensionId;
    // O aviso do Dialog (B3-6; decisão 259(2)): o estorno vai falhar no gateway.
    const pastWindow = pastGatewayWindow({ method: outcome.method, paidAt: outcome.paidAt, now });

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
    return { refundsPaymentIds: ids, pastGatewayWindow: pastWindow };
  }
}
