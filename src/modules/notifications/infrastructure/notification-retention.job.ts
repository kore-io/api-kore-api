import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { upsertDailyScheduler } from '../../../shared/jobs/daily-scheduler';
import { CleanNotifications } from '../application/clean-notifications.use-case';

export const NOTIFICATION_RETENTION_QUEUE = 'notification-retention';
export const NOTIFICATION_RETENTION_SCHEDULER_ID = 'clean-notifications';
// Todo dia às 4h45, horário de Brasília, num horário sem outra rotina.
const DAILY_AT_4_45AM = '45 4 * * *';

const logger = new Logger('NotificationRetention');

/** A retenção diária da central (Central RN08). */
@Processor(NOTIFICATION_RETENTION_QUEUE)
export class NotificationRetentionProcessor extends WorkerHost {
  constructor(private readonly clean: CleanNotifications) {
    super();
  }

  async process(): Promise<{ deleted: number }> {
    const result = await this.clean.execute({ now: new Date() });
    logger.log(`Notificações lidas apagadas: ${result.deleted}.`);
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
export class NotificationRetentionScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(NOTIFICATION_RETENTION_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await upsertDailyScheduler({
      queue: this.queue,
      schedulerId: NOTIFICATION_RETENTION_SCHEDULER_ID,
      cronPattern: DAILY_AT_4_45AM,
      logger,
    });
  }
}
