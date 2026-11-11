import { Injectable } from '@nestjs/common';
import { BackofficePrismaService } from '../../../../shared/database/backoffice-prisma.service';
import type { WeddingStatsRecompute } from '../../application/ports/wedding-stats-recompute.port';
import { recomputeWeddingStats } from './wedding-stats-recompute';

/**
 * Pela conexão do backoffice (sem RLS), como as outras rotinas: um casamento
 * por transação, para o lock da linha durar só a conta daquele casamento.
 */
@Injectable()
export class PrismaWeddingStatsRecompute implements WeddingStatsRecompute {
  constructor(private readonly prisma: BackofficePrismaService) {}

  async recomputeAll(): Promise<number> {
    const rows = await this.prisma.weddingStats.findMany({ select: { weddingId: true } });
    let corrected = 0;
    for (const { weddingId } of rows)
      corrected += await this.prisma.$transaction((tx) =>
        recomputeWeddingStats({ db: tx, weddingId }),
      );
    return corrected;
  }
}
