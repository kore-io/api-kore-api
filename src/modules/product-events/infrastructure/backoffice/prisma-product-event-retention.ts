import { Injectable } from '@nestjs/common';
import { BackofficePrismaService } from '@/shared/database/backoffice-prisma.service';
import type { ProductEventRetention } from '@/modules/product-events/application/ports/product-event-retention.port';
import { WeddingPseudonymizer } from '@/modules/product-events/infrastructure/providers/wedding-pseudonymizer';

const DELETE_BATCH_SIZE = 5_000;

/**
 * Roda com a conexão do backoffice, a única que apaga eventos de produto. Os
 * do casamento bloqueado ficam (decisão 290(1)); o evento só tem o weddingRef
 * (HMAC do id), então a rotina calcula o dos bloqueados e os pula.
 */
@Injectable()
export class PrismaProductEventRetention implements ProductEventRetention {
  constructor(
    private readonly prisma: BackofficePrismaService,
    private readonly pseudonymizer: WeddingPseudonymizer,
  ) {}

  async deleteOccurredBefore({ cutoff }: { cutoff: Date }): Promise<number> {
    const blocked = await this.prisma.wedding.findMany({
      where: { blockedAt: { not: null } },
      select: { id: true },
    });
    const kept = blocked.map(({ id }) => this.pseudonymizer.weddingRef({ weddingId: id }));
    let total = 0;
    for (;;) {
      const deleted = await this.prisma.$executeRaw`
        DELETE FROM product_events
        WHERE id IN (
          SELECT id FROM product_events
          WHERE occurred_at < ${cutoff}
            AND (wedding_ref IS NULL OR NOT (wedding_ref = ANY(${kept}::text[])))
          ORDER BY occurred_at
          LIMIT ${DELETE_BATCH_SIZE}
        )`;
      total += deleted;
      if (deleted < DELETE_BATCH_SIZE) return total;
    }
  }
}
