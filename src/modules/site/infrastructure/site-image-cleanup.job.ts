import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { upsertDailyScheduler } from '../../../shared/jobs/daily-scheduler';
import { CleanSiteImages } from '../application/clean-site-images.use-case';

export const SITE_IMAGE_CLEANUP_QUEUE = 'site-image-cleanup';
export const SITE_IMAGE_CLEANUP_SCHEDULER_ID = 'clean-site-images';
// Todo dia às 2h30, horário de Brasília, num horário sem outra rotina.
const DAILY_AT_2_30AM = '30 2 * * *';

const logger = new Logger('SiteImageCleanup');

/** Executa a limpeza diária das imagens do site (S4 RN08). */
@Processor(SITE_IMAGE_CLEANUP_QUEUE)
export class SiteImageCleanupProcessor extends WorkerHost {
  constructor(private readonly clean: CleanSiteImages) {
    super();
  }

  async process(): Promise<void> {
    const counts = await this.clean.execute({ now: new Date() });
    logger.log(
      `Imagens do site: ${counts.stale} envios abandonados, ${counts.failed} recusadas e ${counts.unused} fora de uso.`,
    );
  }

  // Sem ouvinte de 'error', o worker derruba o processo quando o Redis cai.
  @OnWorkerEvent('error')
  onError(error: Error): void {
    logger.warn(`Worker sem Redis: ${error.name}`);
  }
}

/** Registra (ou atualiza) o agendamento diário na subida do worker. */
@Injectable()
export class SiteImageCleanupScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(SITE_IMAGE_CLEANUP_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await upsertDailyScheduler({
      queue: this.queue,
      schedulerId: SITE_IMAGE_CLEANUP_SCHEDULER_ID,
      cronPattern: DAILY_AT_2_30AM,
      logger,
    });
  }
}
