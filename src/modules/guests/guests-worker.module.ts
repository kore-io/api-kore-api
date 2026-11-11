import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { LogsWorkerModule } from '../logs/logs-worker.module';
import { WEDDING_STATS_RECOMPUTE } from './application/ports/wedding-stats-recompute.port';
import { RecomputeWeddingStats } from './application/recompute-wedding-stats.use-case';
import { PrismaWeddingStatsRecompute } from './infrastructure/backoffice/prisma-wedding-stats-recompute';
import {
  WEDDING_STATS_RECOMPUTE_QUEUE,
  WeddingStatsRecomputeProcessor,
  WeddingStatsRecomputeScheduler,
} from './infrastructure/wedding-stats-recompute.job';

/** Rotinas do contexto Convidados, do lado do worker. */
@Module({
  imports: [
    BullModule.registerQueue({ name: WEDDING_STATS_RECOMPUTE_QUEUE }),
    // O log da aplicação pela conexão do backoffice (registro da execução).
    LogsWorkerModule,
  ],
  providers: [
    { provide: WEDDING_STATS_RECOMPUTE, useClass: PrismaWeddingStatsRecompute },
    RecomputeWeddingStats,
    WeddingStatsRecomputeProcessor,
    WeddingStatsRecomputeScheduler,
  ],
})
export class GuestsWorkerModule {}
