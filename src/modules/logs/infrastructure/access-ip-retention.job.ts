import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { upsertDailyScheduler } from '../../../shared/jobs/daily-scheduler';
import { PurgeExpiredAccessIpLogs } from '../application/purge-expired-access-ip-logs.use-case';

export const ACCESS_IP_RETENTION_QUEUE = 'access-ip-retention';
export const ACCESS_IP_RETENTION_SCHEDULER_ID = 'purge-expired-access-ip-logs';
// Todo dia às 4h, horário de Brasília (fora do pico).
const DAILY_AT_4AM = '0 4 * * *';

const logger = new Logger('AccessIpRetention');

/** Executa a rotina diária de retenção do IP real. */
@Processor(ACCESS_IP_RETENTION_QUEUE)
export class AccessIpRetentionProcessor extends WorkerHost {
  constructor(private readonly purge: PurgeExpiredAccessIpLogs) {
    super();
  }

  async process(): Promise<{ deleted: number }> {
    const { deleted, cutoff } = await this.purge.execute({ now: new Date() });
    logger.log(`IP real apagado: ${deleted} registros anteriores a ${cutoff.toISOString()}`);
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
export class AccessIpRetentionScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(ACCESS_IP_RETENTION_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await upsertDailyScheduler({
      queue: this.queue,
      schedulerId: ACCESS_IP_RETENTION_SCHEDULER_ID,
      cronPattern: DAILY_AT_4AM,
      logger,
    });
  }
}
