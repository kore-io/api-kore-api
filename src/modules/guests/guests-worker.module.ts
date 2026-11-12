import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { LogsWorkerModule } from '../logs/logs-worker.module';
import { WEDDING_STATS_RECOMPUTE } from './application/ports/wedding-stats-recompute.port';
import { RecomputeWeddingStats } from './application/recompute-wedding-stats.use-case';
import { TRASH_PURGE } from './application/ports/trash-purge.port';
import { PurgeTrash } from './application/purge-trash.use-case';
import { PrismaTrashPurge } from './infrastructure/backoffice/prisma-trash-purge';
import {
  TRASH_PURGE_QUEUE,
  TrashPurgeProcessor,
  TrashPurgeScheduler,
} from './infrastructure/trash-purge.job';
import { PrismaWeddingStatsRecompute } from './infrastructure/backoffice/prisma-wedding-stats-recompute';
import {
  WEDDING_STATS_RECOMPUTE_QUEUE,
  WeddingStatsRecomputeProcessor,
  WeddingStatsRecomputeScheduler,
} from './infrastructure/wedding-stats-recompute.job';

/** Rotinas do contexto Convidados, do lado do worker. */
@Module({
  imports: [
    BullModule.registerQueue({ name: WEDDING_STATS_RECOMPUTE_QUEUE }, { name: TRASH_PURGE_QUEUE }),
    // O log da aplicação pela conexão do backoffice (registro da execução).
    LogsWorkerModule,
  ],
  providers: [
    { provide: WEDDING_STATS_RECOMPUTE, useClass: PrismaWeddingStatsRecompute },
    RecomputeWeddingStats,
    WeddingStatsRecomputeProcessor,
    WeddingStatsRecomputeScheduler,
    { provide: TRASH_PURGE, useClass: PrismaTrashPurge },
    PurgeTrash,
    TrashPurgeProcessor,
    TrashPurgeScheduler,
  ],
})
export class GuestsWorkerModule {}
