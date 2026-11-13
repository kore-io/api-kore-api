import { Inject, Injectable } from '@nestjs/common';
import { PAYMENT_GATEWAY, type PaymentGateway } from './ports/payment-gateway.port';
import { type CancelReason, SyncPaymentWithGateway } from './sync-payment.use-case';

/**
 * Cancela um pagamento pendente no gateway e no Kore (Publicar e pagar RN07;
 * Pagamentos e arrependimento RN03), sempre fora de transação (RN19): consulta
 * pela referência, cancela a cobrança, consulta de novo e aplica o estado pelo
 * SyncPaymentWithGateway. Se o gateway diz que já foi pago, o pagamento é
 * aplicado (ou fica sem destino) e o resultado é `paid`.
 */
@Injectable()
export class CancelPendingPayment {
  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly sync: SyncPaymentWithGateway,
  ) {}

  async execute({
    paymentId,
    reason,
    now,
  }: {
    paymentId: string;
    reason: CancelReason;
    now: Date;
  }): Promise<'canceled' | 'paid' | 'unchanged'> {
    let charge = await this.gateway.getCharge({ externalReference: paymentId });
    if (!charge) {
      const result = await this.sync.cancelWithoutCharge({ paymentId, now });
      return result === 'canceled' ? 'canceled' : 'unchanged';
    }
    if (charge.status === 'pending' || charge.status === 'overdue') {
      await this.gateway.cancelCharge({ gatewayPaymentId: charge.gatewayPaymentId });
      // O estado depois do cancelamento: cancelado, ou pago no meio do caminho.
      charge = await this.gateway.getCharge({ externalReference: paymentId });
      if (!charge) return 'unchanged';
    }
    const result = await this.sync.execute({ paymentId, charge, now, cancelReason: reason });
    if (charge.status === 'confirmed') return 'paid';
    return result === 'canceled' ? 'canceled' : 'unchanged';
  }
}
