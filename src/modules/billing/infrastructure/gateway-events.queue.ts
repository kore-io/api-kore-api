import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { GatewayEventQueue } from '../application/ports/gateway-event.queue.port';

/** A fila dos eventos do gateway: `process` (um evento) e a rotina de 5 minutos. */
export const GATEWAY_EVENTS_QUEUE = 'gateway-events';
export const GATEWAY_EVENTS_REQUEUE_SCHEDULER_ID = 'gateway-events-requeue';

export interface ProcessGatewayEventJob {
  eventId: string;
}

/** O id do job pelo evento do gateway (RN09): o mesmo evento não entra duas vezes. */
export function gatewayEventJobId({
  gateway,
  gatewayEventId,
}: {
  gateway: string;
  gatewayEventId: string;
}): string {
  return `${gateway}-${gatewayEventId}`.replace(/:/g, '_');
}

@Injectable()
export class BullmqGatewayEventQueue implements GatewayEventQueue {
  constructor(@InjectQueue(GATEWAY_EVENTS_QUEUE) private readonly queue: Queue) {}

  async enqueue({
    eventId,
    gateway,
    gatewayEventId,
  }: {
    eventId: string;
    gateway: 'local' | 'asaas';
    gatewayEventId: string;
  }): Promise<void> {
    const data: ProcessGatewayEventJob = { eventId };
    // Sem guardar o job concluído nem o que falhou: com o id fixo, um job
    // guardado faria o BullMQ ignorar a reposição da rotina de 5 minutos.
    await this.queue.add('process', data, {
      jobId: gatewayEventJobId({ gateway, gatewayEventId }),
      attempts: 5,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: true,
      removeOnFail: true,
    });
  }
}
