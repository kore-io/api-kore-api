import { Inject, Injectable } from '@nestjs/common';
import { GATEWAY_EVENT_QUEUE, type GatewayEventQueue } from './ports/gateway-event.queue.port';
import { GATEWAY_EVENT_STORE, type GatewayEventStore } from './ports/gateway-event.store.port';

/** Só os parados há mais de 1 minuto: o recém-gravado ainda está entrando na fila. */
const STALE_AFTER_MS = 60_000;
const BATCH = 500;

/**
 * A rotina de 5 minutos (Publicar e pagar RN09; B2-5): repõe na fila os
 * eventos gravados e não processados. O id fixo do job impede o duplicado.
 */
@Injectable()
export class RequeueGatewayEvents {
  constructor(
    @Inject(GATEWAY_EVENT_STORE) private readonly events: GatewayEventStore,
    @Inject(GATEWAY_EVENT_QUEUE) private readonly queue: GatewayEventQueue,
  ) {}

  async execute({ now }: { now: Date }): Promise<{ requeued: number }> {
    const stale = await this.events.unprocessed({
      receivedBefore: new Date(now.getTime() - STALE_AFTER_MS),
      limit: BATCH,
    });
    for (const event of stale) {
      await this.queue.enqueue({
        eventId: event.id,
        gateway: event.gateway,
        gatewayEventId: event.gatewayEventId,
      });
    }
    return { requeued: stale.length };
  }
}
