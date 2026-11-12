import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { upsertDailyScheduler } from '../../../shared/jobs/daily-scheduler';
import { ProcessGatewayEvent } from '../application/process-gateway-event.use-case';
import { RequeueGatewayEvents } from '../application/requeue-gateway-events.use-case';
import {
  GATEWAY_EVENTS_QUEUE,
  GATEWAY_EVENTS_REQUEUE_SCHEDULER_ID,
  type ProcessGatewayEventJob,
} from './gateway-events.queue';

const logger = new Logger('GatewayEvents');
// A cada 5 minutos (Publicar e pagar RN09; B2-5).
const EVERY_5_MINUTES = '*/5 * * * *';

/** O processamento dos eventos do gateway e a rotina que repõe os parados. */
@Processor(GATEWAY_EVENTS_QUEUE)
export class GatewayEventsProcessor extends WorkerHost {
  constructor(
    private readonly processEvent: ProcessGatewayEvent,
    private readonly requeue: RequeueGatewayEvents,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    const now = new Date();
    if (job.name === 'process') {
      return this.processEvent.execute({
        eventId: (job.data as ProcessGatewayEventJob).eventId,
        now,
      });
    }
    // O job do agendamento (o nome é o do agendamento).
    const result = await this.requeue.execute({ now });
    if (result.requeued) logger.log(`Eventos do gateway repostos na fila: ${result.requeued}.`);
    return result;
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    logger.warn(`Job de evento do gateway falhou (${job?.name ?? '?'}): ${error.name}`);
  }

  // Sem ouvinte de 'error', o worker derruba o processo quando o Redis cai.
  @OnWorkerEvent('error')
  onError(error: Error): void {
    logger.warn(`Worker sem Redis: ${error.name}`);
  }
}

/** Registra (ou atualiza) a rotina de 5 minutos na subida do worker. */
@Injectable()
export class GatewayEventsRequeueScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(GATEWAY_EVENTS_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await upsertDailyScheduler({
      queue: this.queue,
      schedulerId: GATEWAY_EVENTS_REQUEUE_SCHEDULER_ID,
      cronPattern: EVERY_5_MINUTES,
      logger,
    });
  }
}
