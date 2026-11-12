import { Injectable } from '@nestjs/common';
import { BackofficePrismaService } from '../../../../shared/database/backoffice-prisma.service';
import type { AccessIpLogRetention } from '../../application/ports/access-ip-log-retention.port';

const DELETE_BATCH_SIZE = 5_000;

/**
 * Roda com a conexão do backoffice: só o papel kore_backoffice pode apagar do
 * log de IP real. Apaga em lotes para não segurar locks longos na tabela.
 */
@Injectable()
export class PrismaAccessIpLogRetention implements AccessIpLogRetention {
  constructor(private readonly prisma: BackofficePrismaService) {}

  async deleteOccurredBefore({ cutoff }: { cutoff: Date }): Promise<number> {
    let total = 0;
    for (;;) {
      const deleted = await this.prisma.$executeRaw`
        DELETE FROM access_ip_logs
        WHERE id IN (
          SELECT id FROM access_ip_logs
          WHERE occurred_at < ${cutoff}
          ORDER BY occurred_at
          LIMIT ${DELETE_BATCH_SIZE}
        )`;
      total += deleted;
      if (deleted < DELETE_BATCH_SIZE) return total;
    }
  }
}
