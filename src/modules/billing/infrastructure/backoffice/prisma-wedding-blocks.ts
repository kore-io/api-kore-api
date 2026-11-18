import { Injectable } from '@nestjs/common';
import { BackofficeTransaction } from '@/shared/database/backoffice-transaction';
import type { WeddingBlocks } from '@/modules/billing/application/ports/wedding-blocks.port';
import {
  BLOCKABLE_PAYOUT_STATUSES,
  isPayoutOpenToBlock,
} from '@/modules/billing/domain/payouts/commission';

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
    ipHash,
    now,
  }: {
    action: string;
    weddingId: string;
    byUserId: string;
    reason: string | null;
    ipHash: string | null;
    now: Date;
  }) {
    await this.db().applicationLog.createMany({
      data: [
        {
          createdAt: now,
          action,
          // Só o staff bloqueia (a rota do Backoffice; decisão 68).
          actorKind: 'admin',
          actorUserId: byUserId,
          weddingId,
          entityType: 'wedding',
          entityId: weddingId,
          // O motivo fica no log, não no casamento (decisão 82: o casal não o vê).
          data: reason ? { reason } : undefined,
          ipHash,
        },
      ],
    });
  }

  async block({
    weddingId,
    byUserId,
    reason,
    ipHash = null,
    now,
  }: {
    weddingId: string;
    byUserId: string;
    reason: string;
    ipHash?: string | null;
    now: Date;
  }) {
    const current = await this.lock(weddingId);
    if (!current) return 'not_found' as const;
    if (current.blocked) return 'already_blocked' as const;
    await this.db().wedding.update({
      where: { id: weddingId },
      data: { blockedAt: now, blockedByUserId: byUserId },
    });
    await this.log({ action: 'wedding.blocked', weddingId, byUserId, reason, ipHash, now });
    await this.blockOpenCommissions({ weddingId });
    return 'blocked' as const;
  }

  /**
   * Decisão 282(3), no padrão da Comissões RN04: as comissões em aberto do
   * casamento (`pending` e `available`, fora de repasse ou num repasse
   * `requested` ou `held`) ficam `blocked` com `wedding_blocked`, e o repasse
   * que as contém fica retido por `commission_blocked` (Repasse RN06 (f)). O
   * repasse já retido (ex.: `pix_key_change`) troca de motivo e espera o Admin:
   * não volta a `requested` sozinho no fim da troca da chave (decisão 286(a)).
   * As pagas, as estornadas e as de um repasse `processing` não mudam; a `held`
   * por contestação fica para o fim da disputa (decisão 286(b), no
   * PrismaPaymentLedger.releaseCommission). Desbloquear o casamento não as
   * libera: o Admin libera uma a uma. Os logs `commission.blocked` e
   * `payout.held` saem pelos triggers, com ator system.
   * Travas na ordem G2: Wedding (já travado) → Referrer → Payout → Commission.
   * O Referrer da comissão `held` também é travado: assim o fim de uma
   * contestação que corre junto (ele trava o Referrer) ou acontece antes, e
   * aqui a comissão já está `available`, ou depois, e lá o casamento já está
   * bloqueado.
   */
  private async blockOpenCommissions({ weddingId }: { weddingId: string }): Promise<void> {
    const tx = this.db();
    const referrers = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM referrers WHERE id IN (
        SELECT referrer_id FROM commissions
        WHERE wedding_id = ${weddingId}::uuid AND status IN ('pending', 'available', 'held'))
      ORDER BY id FOR UPDATE`;
    if (referrers.length === 0) return;
    // Com o Referrer travado, o payout_id das comissões dele não muda.
    const payouts = await tx.$queryRaw<{ id: string; status: string }[]>`
      SELECT id, status::text AS status FROM payouts WHERE id IN (
        SELECT payout_id FROM commissions
        WHERE wedding_id = ${weddingId}::uuid AND status IN ('pending', 'available')
          AND payout_id IS NOT NULL)
      ORDER BY id FOR UPDATE`;
    const open = payouts.filter(({ status }) => isPayoutOpenToBlock(status)).map(({ id }) => id);
    const commissions = await tx.$queryRaw<{ id: string; payoutId: string | null }[]>`
      SELECT id, payout_id AS "payoutId" FROM commissions
      WHERE wedding_id = ${weddingId}::uuid AND status IN ('pending', 'available')
      ORDER BY id FOR UPDATE`;
    const blockable = commissions.filter(
      ({ payoutId }) => payoutId === null || open.includes(payoutId),
    );
    if (blockable.length === 0) return;
    await tx.commission.updateMany({
      where: { id: { in: blockable.map(({ id }) => id) } },
      data: { status: 'blocked', blockReason: 'wedding_blocked' },
    });
    const held = [...new Set(blockable.flatMap(({ payoutId }) => (payoutId ? [payoutId] : [])))];
    if (held.length > 0)
      await tx.payout.updateMany({
        where: { id: { in: held }, status: { in: [...BLOCKABLE_PAYOUT_STATUSES] } },
        data: { status: 'held', holdReason: 'commission_blocked' },
      });
  }

  async unblock({
    weddingId,
    byUserId,
    reason,
    ipHash = null,
    now,
  }: {
    weddingId: string;
    byUserId: string;
    reason: string | null;
    ipHash?: string | null;
    now: Date;
  }) {
    const current = await this.lock(weddingId);
    if (!current) return 'not_found' as const;
    if (!current.blocked) return 'not_blocked' as const;
    await this.db().wedding.update({
      where: { id: weddingId },
      data: { blockedAt: null, blockedByUserId: null },
    });
    await this.log({ action: 'wedding.unblocked', weddingId, byUserId, reason, ipHash, now });
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
