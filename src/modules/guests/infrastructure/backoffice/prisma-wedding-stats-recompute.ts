import { Injectable } from '@nestjs/common';
import { BackofficePrismaService } from '../../../../shared/database/backoffice-prisma.service';
import type { WeddingStatsRecompute } from '../../application/ports/wedding-stats-recompute.port';
import { recomputeWeddingStats } from './wedding-stats-recompute';

/** Pela conexão do backoffice (sem RLS), como as outras rotinas. */
@Injectable()
export class PrismaWeddingStatsRecompute implements WeddingStatsRecompute {
  constructor(private readonly prisma: BackofficePrismaService) {}

  recomputeAll(): Promise<number> {
    return recomputeWeddingStats({ db: this.prisma });
  }
}
