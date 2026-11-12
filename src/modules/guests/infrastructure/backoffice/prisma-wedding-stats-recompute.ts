import { Injectable } from '@nestjs/common';
import { BackofficePrismaService } from '../../../../shared/database/backoffice-prisma.service';
import { postgresErrorCode } from '../../../../shared/database/postgres-error';
import type { WeddingStatsRecompute } from '../../application/ports/wedding-stats-recompute.port';
import { findDivergentWeddingIds, recomputeWeddingStats } from './wedding-stats-recompute';

/** SQLSTATE do lock_timeout: a linha ficou presa além do prazo. */
const LOCK_NOT_AVAILABLE = '55P03';

/**
 * Pela conexão do backoffice (sem RLS), como as outras rotinas. Uma leitura
 * acha os casamentos divergentes; cada um é recalculado na sua transação, com
 * lock_timeout, para uma escrita presa não segurar a rotina inteira.
 */
@Injectable()
export class PrismaWeddingStatsRecompute implements WeddingStatsRecompute {
  /** Quanto esperar pela linha presa por uma escrita (milissegundos). */
  lockTimeoutMs = 5_000;

  constructor(private readonly prisma: BackofficePrismaService) {}

  async recompute({
    weddingId,
  }: {
    weddingId?: string;
  }): Promise<{ corrected: number; skipped: number }> {
    const ids = weddingId ? [weddingId] : await findDivergentWeddingIds({ db: this.prisma });
    let corrected = 0;
    let skipped = 0;
    for (const id of ids) {
      try {
        corrected += await this.prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = ${Math.trunc(this.lockTimeoutMs)}`);
          return recomputeWeddingStats({ db: tx, weddingId: id });
        });
      } catch (error) {
        if (postgresErrorCode({ error }) !== LOCK_NOT_AVAILABLE) throw error;
        skipped += 1;
      }
    }
    return { corrected, skipped };
  }
}
