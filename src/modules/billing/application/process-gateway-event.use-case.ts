import { Inject, Injectable } from '@nestjs/common';
import { GATEWAY_EVENT_STORE, type GatewayEventStore } from './ports/gateway-event.store.port';

export type GatewayEventProcessing =
  | { kind: 'not_found' }
  | { kind: 'already_processed' }
  | { kind: 'processed'; paymentId: string | null; result: string };

/**
 * O processamento de um evento gravado (Publicar e pagar RN09), na fila do
 * worker ou em linha pela rota dev (RN21). Acha o pagamento pela referência
 * do Kore ou pelo id do gateway (B2-1: o webhook pode chegar antes de o Kore
 * gravar o id do gateway) e marca o evento como processado, com o pagamento
 * (o expurgo acha os eventos do casamento por ele, Retenção RN03).
 *
 * A máquina de estados do Payment (RN05, RN08 e RN10), com a consulta à
 * porta, entra no PR do Publicar e pagar; aqui o resultado é `recorded`.
 */
@Injectable()
export class ProcessGatewayEvent {
  constructor(@Inject(GATEWAY_EVENT_STORE) private readonly events: GatewayEventStore) {}

  async execute({ eventId, now }: { eventId: string; now: Date }): Promise<GatewayEventProcessing> {
    const stored = await this.events.byId({ id: eventId });
    if (!stored) return { kind: 'not_found' };
    if (stored.processedAt) return { kind: 'already_processed' };
    const paymentId = await this.events.paymentIdFor({
      externalReference: stored.event.externalReference,
      gatewayPaymentId: stored.event.gatewayPaymentId,
    });
    const result = paymentId ? 'recorded' : 'no_payment';
    await this.events.markProcessed({ id: stored.id, paymentId, result, now });
    return { kind: 'processed', paymentId, result };
  }
}
