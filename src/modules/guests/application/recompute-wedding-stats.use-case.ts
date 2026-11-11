import { Inject, Injectable } from '@nestjs/common';
import {
  APPLICATION_LOG_WRITER,
  type ApplicationLogWriter,
} from '../../logs/application/ports/application-log-writer.port';
import {
  WEDDING_STATS_RECOMPUTE,
  type WeddingStatsRecompute,
} from './ports/wedding-stats-recompute.port';

export const WEDDING_STATS_RECOMPUTED_ACTION = 'wedding_stats.recomputed';

/**
 * Rotina noturna de recálculo (Grupos RN16; decisão 186, item 3): corrige
 * qualquer divergência do WeddingStats em relação ao Guest. O rastro da
 * execução vai para o log da aplicação, com quantos casamentos mudaram.
 */
@Injectable()
export class RecomputeWeddingStats {
  constructor(
    @Inject(WEDDING_STATS_RECOMPUTE) private readonly recompute: WeddingStatsRecompute,
    @Inject(APPLICATION_LOG_WRITER) private readonly applicationLog: ApplicationLogWriter,
  ) {}

  async execute({ now }: { now: Date }): Promise<{ corrected: number }> {
    const corrected = await this.recompute.recomputeAll();
    await this.applicationLog.record({
      entry: {
        action: WEDDING_STATS_RECOMPUTED_ACTION,
        actorKind: 'system',
        data: { corrected, now: now.toISOString() },
      },
    });
    return { corrected };
  }
}
