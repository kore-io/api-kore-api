import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { upsertDailyScheduler } from '../../../shared/jobs/daily-scheduler';
import { PurgeExpiredProductEvents } from '../application/purge-expired-product-events.use-case';

export const PRODUCT_EVENT_RETENTION_QUEUE = 'product-event-retention';
export const PRODUCT_EVENT_RETENTION_SCHEDULER_ID = 'purge-expired-product-events';
// Todo dia às 5h, horário de Brasília: depois das retenções dos logs.
const DAILY_AT_5AM = '0 5 * * *';

const logger = new Logger('ProductEventRetention');

/** Executa a rotina diária de retenção dos eventos de produto. */
@Processor(PRODUCT_EVENT_RETENTION_QUEUE)
export class ProductEventRetentionProcessor extends WorkerHost {
  constructor(private readonly purge: PurgeExpiredProductEvents) {
    super();
  }

  async process(): Promise<{ deleted: number }> {
    const { deleted, cutoff } = await this.purge.execute({ now: new Date() });
    logger.log(`Eventos de produto apagados: ${deleted} anteriores a ${cutoff.toISOString()}`);
    return { deleted };
  }

  // Sem ouvinte de 'error', o worker derruba o processo quando o Redis cai.
  @OnWorkerEvent('error')
  onError(error: Error): void {
    logger.warn(`Worker sem Redis: ${error.name}`);
  }
}

/** Registra (ou atualiza) o agendamento diário na subida do worker. */
@Injectable()
export class ProductEventRetentionScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(PRODUCT_EVENT_RETENTION_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await upsertDailyScheduler({
      queue: this.queue,
      schedulerId: PRODUCT_EVENT_RETENTION_SCHEDULER_ID,
      cronPattern: DAILY_AT_5AM,
      logger,
    });
  }
}
