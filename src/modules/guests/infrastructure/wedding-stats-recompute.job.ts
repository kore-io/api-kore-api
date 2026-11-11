import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { upsertDailyScheduler } from '../../../shared/jobs/daily-scheduler';
import { RecomputeWeddingStats } from '../application/recompute-wedding-stats.use-case';

export const WEDDING_STATS_RECOMPUTE_QUEUE = 'wedding-stats-recompute';
export const WEDDING_STATS_RECOMPUTE_SCHEDULER_ID = 'recompute-wedding-stats';
// Todo dia às 3h30, horário de Brasília: de madrugada, antes das outras rotinas.
const DAILY_AT_3_30AM = '30 3 * * *';

const logger = new Logger('WeddingStatsRecompute');

/** Executa o recálculo noturno dos números do casamento (Grupos RN16). */
@Processor(WEDDING_STATS_RECOMPUTE_QUEUE)
export class WeddingStatsRecomputeProcessor extends WorkerHost {
  constructor(private readonly recompute: RecomputeWeddingStats) {
    super();
  }

  async process(): Promise<{ corrected: number }> {
    const result = await this.recompute.execute({ now: new Date() });
    logger.log(`Recálculo: ${result.corrected} casamentos corrigidos.`);
    return result;
  }

  // Sem ouvinte de 'error', o worker derruba o processo quando o Redis cai.
  @OnWorkerEvent('error')
  onError(error: Error): void {
    logger.warn(`Worker sem Redis: ${error.name}`);
  }
}

/** Registra (ou atualiza) o agendamento diário na subida do worker. */
@Injectable()
export class WeddingStatsRecomputeScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(WEDDING_STATS_RECOMPUTE_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await upsertDailyScheduler({
      queue: this.queue,
      schedulerId: WEDDING_STATS_RECOMPUTE_SCHEDULER_ID,
      cronPattern: DAILY_AT_3_30AM,
      logger,
    });
  }
}
