import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { LogsWorkerModule } from '../logs/logs-worker.module';
import { CleanSitePreviewTokens } from './application/clean-site-preview-tokens.use-case';
import { SITE_PREVIEW_TOKEN_CLEANUP } from './application/ports/site-preview-token-cleanup.port';
import { PrismaSitePreviewTokenCleanup } from './infrastructure/backoffice/prisma-site-preview-token-cleanup';
import { CleanSiteImages } from './application/clean-site-images.use-case';
import { SITE_IMAGE_CLEANUP } from './application/ports/site-image-cleanup.port';
import { PrismaSiteImageCleanup } from './infrastructure/backoffice/prisma-site-image-cleanup';
import {
  SITE_IMAGE_CLEANUP_QUEUE,
  SiteImageCleanupProcessor,
  SiteImageCleanupScheduler,
} from './infrastructure/site-image-cleanup.job';
import { MoveToPostEvent } from './application/move-to-post-event.use-case';
import { POST_EVENT_TRANSITION } from './application/ports/post-event-transition.port';
import { PrismaPostEventTransition } from './infrastructure/backoffice/prisma-post-event-transition';
import {
  POST_EVENT_QUEUE,
  PostEventProcessor,
  PostEventScheduler,
} from './infrastructure/post-event.job';

/** Rotinas do contexto Site, do lado do worker: a limpeza e o pós-evento. */
@Module({
  imports: [
    BullModule.registerQueue({ name: SITE_IMAGE_CLEANUP_QUEUE }),
    BullModule.registerQueue({ name: POST_EVENT_QUEUE }),
    // O log da aplicação pela conexão do backoffice (registro da execução).
    LogsWorkerModule,
  ],
  providers: [
    { provide: SITE_IMAGE_CLEANUP, useClass: PrismaSiteImageCleanup },
    CleanSiteImages,
    { provide: SITE_PREVIEW_TOKEN_CLEANUP, useClass: PrismaSitePreviewTokenCleanup },
    CleanSitePreviewTokens,
    SiteImageCleanupProcessor,
    SiteImageCleanupScheduler,
    { provide: POST_EVENT_TRANSITION, useClass: PrismaPostEventTransition },
    MoveToPostEvent,
    PostEventProcessor,
    PostEventScheduler,
  ],
})
export class SiteWorkerModule {}
