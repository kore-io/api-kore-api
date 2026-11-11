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
 * execução vai para o log da aplicação: quantos mudaram, quantos ficaram para
 * a próxima noite e quanto tempo levou.
 */
@Injectable()
export class RecomputeWeddingStats {
  constructor(
    @Inject(WEDDING_STATS_RECOMPUTE) private readonly recompute: WeddingStatsRecompute,
    @Inject(APPLICATION_LOG_WRITER) private readonly applicationLog: ApplicationLogWriter,
  ) {}

  /** weddingId: só esse casamento (o seed e os testes); sem ele, todos os divergentes. */
  async execute({
    now,
    weddingId,
    clock = () => Date.now(),
  }: {
    now: Date;
    weddingId?: string;
    clock?: () => number;
  }): Promise<{ corrected: number; skipped: number }> {
    const started = clock();
    const result = await this.recompute.recompute({ weddingId });
    await this.applicationLog.record({
      entry: {
        action: WEDDING_STATS_RECOMPUTED_ACTION,
        actorKind: 'system',
        data: { ...result, durationMs: clock() - started, now: now.toISOString() },
      },
    });
    return result;
  }
}
