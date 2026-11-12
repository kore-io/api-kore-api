import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { upsertDailyScheduler } from '../../../shared/jobs/daily-scheduler';
import { PurgeEndedAccess } from '../application/purge-ended-access.use-case';

export const ACCESS_CLEANUP_QUEUE = 'access-cleanup';
export const ACCESS_CLEANUP_SCHEDULER_ID = 'purge-ended-access';
// Todo dia às 5h30, horário de Brasília: depois das outras rotinas.
const DAILY_AT_5_30AM = '30 5 * * *';

const logger = new Logger('AccessCleanup');

/** Executa a limpeza diária de sessões e pedidos de login. */
@Processor(ACCESS_CLEANUP_QUEUE)
export class AccessCleanupProcessor extends WorkerHost {
  constructor(private readonly purge: PurgeEndedAccess) {
    super();
  }

  async process(): Promise<{ sessions: number; loginChallenges: number }> {
    const result = await this.purge.execute({ now: new Date() });
    logger.log(`Limpeza: ${result.sessions} sessões e ${result.loginChallenges} pedidos de login.`);
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
export class AccessCleanupScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(ACCESS_CLEANUP_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await upsertDailyScheduler({
      queue: this.queue,
      schedulerId: ACCESS_CLEANUP_SCHEDULER_ID,
      cronPattern: DAILY_AT_5_30AM,
      logger,
    });
  }
}
