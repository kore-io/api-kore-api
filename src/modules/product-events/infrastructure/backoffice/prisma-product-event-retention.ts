import { Injectable } from '@nestjs/common';
import { BackofficePrismaService } from '../../../../shared/database/backoffice-prisma.service';
import type { ProductEventRetention } from '../../application/ports/product-event-retention.port';

const DELETE_BATCH_SIZE = 5_000;

/** Roda com a conexão do backoffice, a única que apaga eventos de produto. */
@Injectable()
export class PrismaProductEventRetention implements ProductEventRetention {
  constructor(private readonly prisma: BackofficePrismaService) {}

  async deleteOccurredBefore({ cutoff }: { cutoff: Date }): Promise<number> {
    let total = 0;
    for (;;) {
      const deleted = await this.prisma.$executeRaw`
        DELETE FROM product_events
        WHERE id IN (
          SELECT id FROM product_events
          WHERE occurred_at < ${cutoff}
          ORDER BY occurred_at
          LIMIT ${DELETE_BATCH_SIZE}
        )`;
      total += deleted;
      if (deleted < DELETE_BATCH_SIZE) return total;
    }
  }
}
