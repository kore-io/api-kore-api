import { Injectable } from '@nestjs/common';
import { BackofficeTransaction } from '../../../../shared/database/backoffice-transaction';
import type { WeddingBlocks } from '../../application/ports/wedding-blocks.port';

/** Na transação corrente da BackofficeTransaction (kore_backoffice). */
@Injectable()
export class PrismaWeddingBlocks implements WeddingBlocks {
  constructor(private readonly transaction: BackofficeTransaction) {}

  private db() {
    return this.transaction.client();
  }

  /** O Wedding travado primeiro (Publicar e pagar RN18); nulo sem o casamento. */
  private async lock(weddingId: string) {
    const [row] = await this.db().$queryRaw<{ blocked: boolean }[]>`
      SELECT blocked_at IS NOT NULL AS blocked FROM weddings
      WHERE id = ${weddingId}::uuid AND status <> 'purged' FOR UPDATE`;
    return row ?? null;
  }

  private async log({
    action,
    weddingId,
    byUserId,
    reason,
    now,
  }: {
    action: string;
    weddingId: string;
    byUserId: string;
    reason: string | null;
    now: Date;
  }) {
    await this.db().applicationLog.createMany({
      data: [
        {
          createdAt: now,
          action,
          actorKind: 'user',
          actorUserId: byUserId,
          weddingId,
          entityType: 'wedding',
          entityId: weddingId,
          // O motivo fica no log, não no casamento (decisão 82: o casal não o vê).
          data: reason ? { reason } : undefined,
        },
      ],
    });
  }

  async block({
    weddingId,
    byUserId,
    reason,
    now,
  }: {
    weddingId: string;
    byUserId: string;
    reason: string;
    now: Date;
  }) {
    const current = await this.lock(weddingId);
    if (!current) return 'not_found' as const;
    if (current.blocked) return 'already_blocked' as const;
    await this.db().wedding.update({
      where: { id: weddingId },
      data: { blockedAt: now, blockedByUserId: byUserId },
    });
    await this.log({ action: 'wedding.blocked', weddingId, byUserId, reason, now });
    return 'blocked' as const;
  }

  async unblock({
    weddingId,
    byUserId,
    reason,
    now,
  }: {
    weddingId: string;
    byUserId: string;
    reason: string | null;
    now: Date;
  }) {
    const current = await this.lock(weddingId);
    if (!current) return 'not_found' as const;
    if (!current.blocked) return 'not_blocked' as const;
    await this.db().wedding.update({
      where: { id: weddingId },
      data: { blockedAt: null, blockedByUserId: null },
    });
    await this.log({ action: 'wedding.unblocked', weddingId, byUserId, reason, now });
    return 'unblocked' as const;
  }

  async pendingPaymentIds({ weddingId }: { weddingId: string }): Promise<string[]> {
    const rows = await this.db().payment.findMany({
      where: { weddingId, status: 'pending' },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }
}
