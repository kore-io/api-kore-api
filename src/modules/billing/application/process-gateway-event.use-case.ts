import { Inject, Injectable } from '@nestjs/common';
import { GATEWAY_EVENT_STORE, type GatewayEventStore } from './ports/gateway-event.store.port';
import { PAYMENT_GATEWAY, type PaymentGateway } from './ports/payment-gateway.port';
import { SyncPaymentWithGateway } from './sync-payment.use-case';

export type GatewayEventProcessing =
  | { kind: 'not_found' }
  | { kind: 'already_processed' }
  | { kind: 'processed'; paymentId: string | null; result: string };

/**
 * O processamento de um evento gravado (Publicar e pagar RN09), na fila do
 * worker ou em linha pela rota dev (RN21):
 * - acha o pagamento pela referência do Kore ou pelo id do gateway (B2-1: o
 *   webhook pode chegar antes de o Kore gravar o id do gateway);
 * - num evento de cobrança, consulta a cobrança pela porta e aplica o estado
 *   que a consulta devolve (o webhook é gatilho, não fonte: o evento forjado,
 *   repetido ou fora de ordem não muda nada);
 * - marca o evento como processado, com o pagamento e o resultado (o expurgo
 *   acha os eventos do casamento pelo pagamento, Retenção RN03).
 * Se a consulta falha, o erro sobe e o job tenta de novo; o evento continua
 * sem `processedAt` e a rotina de 5 minutos o repõe.
 */
@Injectable()
export class ProcessGatewayEvent {
  constructor(
    @Inject(GATEWAY_EVENT_STORE) private readonly events: GatewayEventStore,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly sync: SyncPaymentWithGateway,
  ) {}

  async execute({ eventId, now }: { eventId: string; now: Date }): Promise<GatewayEventProcessing> {
    const stored = await this.events.byId({ id: eventId });
    if (!stored) return { kind: 'not_found' };
    if (stored.processedAt) return { kind: 'already_processed' };
    const paymentId = await this.events.paymentIdFor({
      externalReference: stored.event.externalReference,
      gatewayPaymentId: stored.event.gatewayPaymentId,
    });

    let result: string;
    if (!paymentId) result = 'no_payment';
    else if (!stored.event.type.startsWith('charge.')) result = 'not_handled';
    else {
      // A consulta pela referência do Kore, que é o id do Payment (RN03, passo 1).
      const charge = await this.gateway.getCharge({ externalReference: paymentId });
      result = charge ? await this.sync.execute({ paymentId, charge, now }) : 'charge_not_found';
    }
    await this.events.markProcessed({ id: stored.id, paymentId, result, now });
    return { kind: 'processed', paymentId, result };
  }
}
