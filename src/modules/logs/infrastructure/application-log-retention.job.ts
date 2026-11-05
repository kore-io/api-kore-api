import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { upsertDailyScheduler } from '../../../shared/jobs/daily-scheduler';
import { PurgeExpiredApplicationLogs } from '../application/purge-expired-application-logs.use-case';

export const APPLICATION_LOG_RETENTION_QUEUE = 'application-log-retention';
export const APPLICATION_LOG_RETENTION_SCHEDULER_ID = 'purge-expired-application-logs';
// Todo dia às 4h30, horário de Brasília: depois da retenção do IP real.
const DAILY_AT_4_30AM = '30 4 * * *';

const logger = new Logger('ApplicationLogRetention');

/** Executa a rotina diária de retenção do log da aplicação. */
@Processor(APPLICATION_LOG_RETENTION_QUEUE)
export class ApplicationLogRetentionProcessor extends WorkerHost {
  constructor(private readonly purge: PurgeExpiredApplicationLogs) {
    super();
  }

  async process(): Promise<{ deleted: number }> {
    const { deleted, cutoff } = await this.purge.execute({ now: new Date() });
    logger.log(
      `Log da aplicação apagado: ${deleted} registros anteriores a ${cutoff.toISOString()}`,
    );
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
export class ApplicationLogRetentionScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(APPLICATION_LOG_RETENTION_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await upsertDailyScheduler({
      queue: this.queue,
      schedulerId: APPLICATION_LOG_RETENTION_SCHEDULER_ID,
      cronPattern: DAILY_AT_4_30AM,
      logger,
    });
  }
}
