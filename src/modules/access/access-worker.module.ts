import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { LogsWorkerModule } from '../logs/logs-worker.module';
import { ACCESS_CLEANUP } from './application/ports/access-cleanup.port';
import { PurgeEndedAccess } from './application/purge-ended-access.use-case';
import {
  ACCESS_CLEANUP_QUEUE,
  AccessCleanupProcessor,
  AccessCleanupScheduler,
} from './infrastructure/access-cleanup.job';
import { PrismaAccessCleanup } from './infrastructure/backoffice/prisma-access-cleanup';

/** Rotinas do contexto Acesso, do lado do worker. */
@Module({
  imports: [
    BullModule.registerQueue({ name: ACCESS_CLEANUP_QUEUE }),
    // O log da aplicação pela conexão do backoffice (registro da execução).
    LogsWorkerModule,
  ],
  providers: [
    { provide: ACCESS_CLEANUP, useClass: PrismaAccessCleanup },
    PurgeEndedAccess,
    AccessCleanupProcessor,
    AccessCleanupScheduler,
  ],
})
export class AccessWorkerModule {}
