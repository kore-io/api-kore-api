import { Injectable } from '@nestjs/common';
import { BackofficePrismaService } from '../../../../shared/database/backoffice-prisma.service';
import type { ApplicationLogRetention } from '../../application/ports/application-log-retention.port';

const DELETE_BATCH_SIZE = 5_000;

/**
 * Roda com a conexão do backoffice: só o papel kore_backoffice pode apagar do
 * log da aplicação. Apaga em lotes para não segurar locks longos na tabela.
 */
@Injectable()
export class PrismaApplicationLogRetention implements ApplicationLogRetention {
  constructor(private readonly prisma: BackofficePrismaService) {}

  async deleteCreatedBefore({ cutoff }: { cutoff: Date }): Promise<number> {
    let total = 0;
    for (;;) {
      const deleted = await this.prisma.$executeRaw`
        DELETE FROM application_logs
        WHERE id IN (
          SELECT id FROM application_logs
          WHERE created_at < ${cutoff}
          ORDER BY created_at
          LIMIT ${DELETE_BATCH_SIZE}
        )`;
      total += deleted;
      if (deleted < DELETE_BATCH_SIZE) return total;
    }
  }
}
