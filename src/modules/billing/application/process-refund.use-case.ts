import { Inject, Injectable } from '@nestjs/common';
import { BackofficeTransaction } from '../../../shared/database/backoffice-transaction';
import {
  GatewayUnavailableError,
  PAYMENT_GATEWAY,
  type PaymentGateway,
} from './ports/payment-gateway.port';
import { PAYMENT_LEDGER, type PaymentLedger } from './ports/payment-ledger.port';
import { type SyncResult, SyncPaymentWithGateway } from './sync-payment.use-case';

export type RefundProcessing =
  'not_requested' | 'given_up' | 'already_refunded' | 'requested' | SyncResult;

/**
 * Uma tentativa de estorno pela porta (Pagamentos e arrependimento RN04 e
 * RN05), no worker, depois do commit do pedido:
 * - só o pagamento em `refund_requested` que ainda não desistiu;
 * - **consulta a cobrança antes de chamar**: se o gateway já estornou, aplica
 *   o estorno sem chamar de novo (nem todo gateway é idempotente no estorno);
 * - conta a tentativa e chama a porta, fora de transação (G1); o gateway pode
 *   responder na hora ("estornado") ou depois, pelo webhook;
 * - a chamada sem resposta conta como falha, com nova tentativa (RN05).
 */
@Injectable()
export class ProcessRefund {
  constructor(
    @Inject(PAYMENT_LEDGER) private readonly ledger: PaymentLedger,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly transaction: BackofficeTransaction,
    private readonly sync: SyncPaymentWithGateway,
  ) {}

  async execute({ paymentId, now }: { paymentId: string; now: Date }): Promise<RefundProcessing> {
    const current = await this.transaction.run(() => this.ledger.lock({ paymentId }));
    if (!current) return 'no_payment';
    const { payment } = current;
    if (payment.status !== 'refund_requested') return 'not_requested';
    if (payment.refundFailedAt) return 'given_up';

    // Cada rodada do job é uma tentativa (RN05: 4 no total), conte ela com uma
    // chamada ou não: a falha antes da chamada não reagenda a mesma tentativa.
    await this.transaction.run(() => this.ledger.countRefundAttempt({ paymentId }));
    try {
      const before = await this.gateway.getCharge({ externalReference: paymentId });
      if (before?.status === 'refunded') {
        await this.sync.execute({ paymentId, charge: before, now });
        return 'already_refunded';
      }
      const gatewayPaymentId = before?.gatewayPaymentId ?? payment.gatewayPaymentId;
      if (!gatewayPaymentId)
        return await this.sync.refundCallFailed({ paymentId, error: 'charge_not_found', now });

      const { result } = await this.gateway.refundCharge({ gatewayPaymentId });
      if (result === 'requested') return 'requested';
      const after = await this.gateway.getCharge({ externalReference: paymentId });
      return after ? await this.sync.execute({ paymentId, charge: after, now }) : 'requested';
    } catch (error) {
      if (!(error instanceof GatewayUnavailableError)) throw error;
      return this.sync.refundCallFailed({ paymentId, error: 'gateway_unavailable', now });
    }
  }
}
