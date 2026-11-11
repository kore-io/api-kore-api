import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { LogsWorkerModule } from '../logs/logs-worker.module';
import { CleanSiteImages } from './application/clean-site-images.use-case';
import { SITE_IMAGE_CLEANUP } from './application/ports/site-image-cleanup.port';
import { PrismaSiteImageCleanup } from './infrastructure/backoffice/prisma-site-image-cleanup';
import {
  SITE_IMAGE_CLEANUP_QUEUE,
  SiteImageCleanupProcessor,
  SiteImageCleanupScheduler,
} from './infrastructure/site-image-cleanup.job';

/** Rotinas do contexto Site, do lado do worker. */
@Module({
  imports: [
    BullModule.registerQueue({ name: SITE_IMAGE_CLEANUP_QUEUE }),
    // O log da aplicação pela conexão do backoffice (registro da execução).
    LogsWorkerModule,
  ],
  providers: [
    { provide: SITE_IMAGE_CLEANUP, useClass: PrismaSiteImageCleanup },
    CleanSiteImages,
    SiteImageCleanupProcessor,
    SiteImageCleanupScheduler,
  ],
})
export class SiteWorkerModule {}
