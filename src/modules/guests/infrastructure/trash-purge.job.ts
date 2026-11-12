import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { upsertDailyScheduler } from '../../../shared/jobs/daily-scheduler';
import type { PurgeCounts } from '../application/ports/trash-purge.port';
import { PurgeTrash } from '../application/purge-trash.use-case';

export const TRASH_PURGE_QUEUE = 'trash-purge';
export const TRASH_PURGE_SCHEDULER_ID = 'purge-trash';
// Todo dia às 3h, horário de Brasília: antes do recálculo dos números (3h30).
const DAILY_AT_3AM = '0 3 * * *';

const logger = new Logger('TrashPurge');

/** Executa o expurgo diário da lixeira (Lixeira RN10). */
@Processor(TRASH_PURGE_QUEUE)
export class TrashPurgeProcessor extends WorkerHost {
  constructor(private readonly purge: PurgeTrash) {
    super();
  }

  async process(): Promise<PurgeCounts> {
    const counts = await this.purge.execute({ now: new Date() });
    logger.log(
      `Expurgo: ${counts.parties} grupos, ${counts.guests} convidados e ${counts.tags} tags.`,
    );
    return counts;
  }

  // Sem ouvinte de 'error', o worker derruba o processo quando o Redis cai.
  @OnWorkerEvent('error')
  onError(error: Error): void {
    logger.warn(`Worker sem Redis: ${error.name}`);
  }
}

/** Registra (ou atualiza) o agendamento diário na subida do worker. */
@Injectable()
export class TrashPurgeScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(TRASH_PURGE_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await upsertDailyScheduler({
      queue: this.queue,
      schedulerId: TRASH_PURGE_SCHEDULER_ID,
      cronPattern: DAILY_AT_3AM,
      logger,
    });
  }
}
