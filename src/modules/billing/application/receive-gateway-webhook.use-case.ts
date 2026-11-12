import { Inject, Injectable, Logger } from '@nestjs/common';
import { GATEWAY_EVENT_QUEUE, type GatewayEventQueue } from './ports/gateway-event.queue.port';
import { GATEWAY_EVENT_STORE, type GatewayEventStore } from './ports/gateway-event.store.port';
import { PAYMENT_GATEWAY, type PaymentGateway } from './ports/payment-gateway.port';

const logger = new Logger('ReceiveGatewayWebhook');

export type WebhookReceipt =
  | { kind: 'unknown_gateway' }
  | { kind: 'invalid_signature' }
  | { kind: 'malformed' }
  | { kind: 'recorded'; eventId: string; duplicate: boolean };

/**
 * O webhook do gateway (Publicar e pagar RN09; decisão 230, risco 1):
 * 1. a assinatura antes de tudo; inválida, nada é gravado;
 * 2. grava o GatewayEvent (único por gateway e id); se o banco falhar, o erro
 *    sobe e a resposta é 5xx, para o gateway reenviar;
 * 3. põe na fila com id fixo. Se a fila falhar, o evento já está gravado e a
 *    rotina de 5 minutos o repõe (B2-5). O evento repetido ainda não
 *    processado também volta à fila.
 */
@Injectable()
export class ReceiveGatewayWebhook {
  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(GATEWAY_EVENT_STORE) private readonly events: GatewayEventStore,
    @Inject(GATEWAY_EVENT_QUEUE) private readonly queue: GatewayEventQueue,
  ) {}

  async execute({
    gateway,
    headers,
    rawBody,
    now,
  }: {
    gateway: string;
    headers: Record<string, string | string[] | undefined>;
    rawBody: Buffer;
    now: Date;
  }): Promise<WebhookReceipt> {
    if (gateway !== this.gateway.name) return { kind: 'unknown_gateway' };
    const verification = this.gateway.verifyWebhook({ headers, rawBody });
    if (verification.kind !== 'event') return verification;
    const { event } = verification;
    const stored = await this.events.record({ gateway: this.gateway.name, event, now });
    if (stored.processedAt === null) {
      try {
        await this.queue.enqueue({
          eventId: stored.id,
          gateway: this.gateway.name,
          gatewayEventId: event.gatewayEventId,
        });
      } catch (error) {
        // Gravado: a rotina de 5 minutos repõe (B2-5).
        logger.warn(`Evento gravado e fora da fila (${(error as Error).name}).`);
      }
    }
    return { kind: 'recorded', eventId: stored.id, duplicate: !stored.created };
  }
}
