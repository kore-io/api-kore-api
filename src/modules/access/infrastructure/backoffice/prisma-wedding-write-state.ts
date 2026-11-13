import { Injectable } from '@nestjs/common';
import { BackofficePrismaService } from '../../../../shared/database/backoffice-prisma.service';
import type { WeddingWriteState } from '../../application/ports/wedding-write-state.port';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pela conexão do backoffice, porque o guard roda antes da transação da
 * requisição (sem RLS): a conferência do vínculo é explícita.
 */
@Injectable()
export class PrismaWeddingWriteState implements WeddingWriteState {
  constructor(private readonly prisma: BackofficePrismaService) {}

  async blockOf({ userId, weddingId }: { userId: string; weddingId: string }) {
    if (!UUID.test(weddingId)) return null;
    const [row] = await this.prisma.$queryRaw<{ blocked: boolean; deletion: boolean }[]>`
      SELECT w.blocked_at IS NOT NULL AS blocked, w.deletion_scheduled_for IS NOT NULL AS deletion
      FROM weddings w
      JOIN memberships m ON m.wedding_id = w.id AND m.user_id = ${userId}::uuid
        AND m.removed_at IS NULL
      WHERE w.id = ${weddingId}::uuid`;
    if (!row) return null;
    // Com os dois, vale o bloqueio (RN02).
    if (row.blocked) return 'blocked' as const;
    return row.deletion ? ('deletion_scheduled' as const) : null;
  }
}
