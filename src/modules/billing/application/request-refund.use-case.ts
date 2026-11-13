import { Inject, Injectable, Logger } from '@nestjs/common';
import { uuidV7 } from '../../../shared/ids/uuid-v7';
import { WeddingScope } from '../../access/application/wedding-scope.service';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import {
  APPLICATION_LOG_WRITER,
  type ApplicationLogWriter,
} from '../../logs/application/ports/application-log-writer.port';
import {
  BillingWeddingBlockedError,
  PaymentDisputedError,
  PaymentNotFoundError,
  PaymentNotPaidError,
  RefundAlreadyRequestedError,
  RefundNotLastExtensionError,
  RefundWindowClosedError,
} from '../domain/billing.errors';
import { CancelPendingPayment } from './cancel-pending-payment';
import { REFUND_QUEUE, type RefundQueue } from './ports/refund-queue.port';
import {
  REFUND_REQUEST_STORE,
  type RefundRequestResult,
  type RefundRequestStore,
} from './ports/refund-request.store.port';

const logger = new Logger('RequestRefund');

export interface RefundRequested {
  status: 'refund_requested';
  /** O pagamento pedido e, na publicação, as extensões que vão junto (RN03). */
  refundsPaymentIds: string[];
}

/**
 * Desistir e pedir reembolso (Pagamentos e arrependimento RN02 a RN04 e RN08):
 * só o dono (`manage_billing`). Numa transação, pela função SECURITY DEFINER
 * `request_payment_refund` (Publicar e pagar RN20): o pagamento (e, na
 * publicação, as extensões pagas) passa a `refund_requested`, o site volta a
 * rascunho (publicação) ou a data volta à anterior (extensão), e o 2º
 * reembolso de publicação abre o `repeated_refund`. Os logs vão na mesma
 * transação. Depois do commit, um job de estorno por pagamento (RN04; G1) e,
 * na publicação, o cancelamento do Pix de extensão pendente.
 */
@Injectable()
export class RequestRefund {
  constructor(
    private readonly scope: WeddingScope,
    private readonly authorization: WeddingAuthorization,
    @Inject(REFUND_REQUEST_STORE) private readonly store: RefundRequestStore,
    @Inject(REFUND_QUEUE) private readonly refunds: RefundQueue,
    @Inject(APPLICATION_LOG_WRITER) private readonly log: ApplicationLogWriter,
    private readonly cancelPending: CancelPendingPayment,
  ) {}

  async execute({
    userId,
    weddingId,
    paymentId,
    reason,
    ip,
    now,
  }: {
    userId: string;
    weddingId: string;
    paymentId: string;
    reason: string | null;
    ip: string | null;
    now: Date;
  }): Promise<RefundRequested> {
    const { paymentIds, pendingExtensionId } = await this.scope.run({
      userId,
      weddingId,
      work: async () => {
        await this.authorization.require({ userId, weddingId, action: 'manage_billing' });
        const requested = await this.store.request({
          weddingId,
          paymentId,
          reason,
          now,
          alertId: uuidV7({ now: now.getTime() }),
        });
        refusal({ result: requested.result, refundableUntil: requested.refundableUntil });
        const rows = await this.store.payments({ weddingId, ids: requested.paymentIds });
        for (const row of rows)
          await this.log.record({
            entry: {
              action: 'payment.refund_requested',
              actorKind: 'user',
              actorUserId: userId,
              weddingId,
              entityType: 'payment',
              entityId: row.id,
              data: {
                refundOrigin: 'couple',
                kind: row.kind,
                amountCents: row.amountCents,
                requestedPaymentId: paymentId,
              },
              ...(ip ? { ip } : {}),
            },
          });
        const publication = rows.some((row) => row.id === paymentId && row.kind === 'publication');
        return {
          paymentIds: requested.paymentIds,
          pendingExtensionId: publication
            ? await this.store.pendingExtensionId({ weddingId })
            : null,
        };
      },
    });

    // Depois do commit (RN04; G1). Sem a fila, a reconciliação repõe o estorno.
    for (const id of paymentIds) {
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
        // A reconciliação cancela o Pix pendente que vencer.
        logger.warn(
          `Pix de extensão ${pendingExtensionId} não cancelado: ${(error as Error).name}`,
        );
      }
    }
    return { status: 'refund_requested', refundsPaymentIds: paymentIds };
  }
}

function refusal({
  result,
  refundableUntil,
}: {
  result: RefundRequestResult;
  refundableUntil: Date | null;
}): void {
  switch (result) {
    case 'requested':
      return;
    case 'not_found':
      throw new PaymentNotFoundError();
    case 'blocked':
      throw new BillingWeddingBlockedError();
    case 'already_requested':
      throw new RefundAlreadyRequestedError();
    case 'disputed':
      throw new PaymentDisputedError();
    case 'not_paid':
      throw new PaymentNotPaidError();
    case 'window_closed':
      throw new RefundWindowClosedError(refundableUntil);
    case 'not_last_extension':
      throw new RefundNotLastExtensionError();
  }
}
