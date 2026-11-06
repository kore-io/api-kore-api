import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { upsertDailyScheduler } from '../../../shared/jobs/daily-scheduler';
import { PurgeOwnerlessWeddings } from '../application/purge-ownerless-weddings.use-case';

export const OWNERLESS_PURGE_QUEUE = 'ownerless-purge';
export const OWNERLESS_PURGE_SCHEDULER_ID = 'purge-ownerless-weddings';
// Todo dia às 6h, horário de Brasília: depois da limpeza de acesso.
const DAILY_AT_6AM = '0 6 * * *';

const logger = new Logger('OwnerlessPurge');

/** Avisa e expurga os casamentos sem dono e sem atividade (RN13 de Convites). */
@Processor(OWNERLESS_PURGE_QUEUE)
export class OwnerlessPurgeProcessor extends WorkerHost {
  constructor(private readonly purge: PurgeOwnerlessWeddings) {
    super();
  }

  async process(): Promise<{ notices: number; purged: number }> {
    const result = await this.purge.execute({ now: new Date() });
    logger.log(`Sem dono: ${result.notices} avisos e ${result.purged} casamentos expurgados.`);
    return result;
  }

  // Sem ouvinte de 'error', o worker derruba o processo quando o Redis cai.
  @OnWorkerEvent('error')
  onError(error: Error): void {
    logger.warn(`Worker sem Redis: ${error.name}`);
  }
}

@Injectable()
export class OwnerlessPurgeScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(OWNERLESS_PURGE_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await upsertDailyScheduler({
      queue: this.queue,
      schedulerId: OWNERLESS_PURGE_SCHEDULER_ID,
      cronPattern: DAILY_AT_6AM,
      logger,
    });
  }
}
