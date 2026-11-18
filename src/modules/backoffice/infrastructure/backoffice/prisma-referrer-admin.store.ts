import { Injectable } from '@nestjs/common';
import type { Prisma } from '@/generated/prisma/client';
import { BackofficeTransaction } from '@/shared/database/backoffice-transaction';
import { uuidV7 } from '@/shared/kernel/ids/uuid-v7';
import type {
  LockedCommission,
  LockedReferrer,
  ReferrerAdminStore,
} from '@/modules/backoffice/application/ports/referrer-admin.store.port';

/** Pelo kore_backoffice, na transação corrente (decisão 180(5)). */
@Injectable()
export class PrismaReferrerAdminStore implements ReferrerAdminStore {
  constructor(private readonly transaction: BackofficeTransaction) {}

  private db(): Prisma.TransactionClient {
    return this.transaction.client();
  }

  private async log({
    action,
    entityType,
    entityId,
    adminUserId,
    data,
    now,
  }: {
    action: string;
    entityType: string;
    entityId: string;
    adminUserId: string;
    data: Record<string, unknown>;
    now: Date;
  }): Promise<void> {
    await this.db().applicationLog.create({
      data: {
        createdAt: now,
        action,
        actorKind: 'admin',
        actorUserId: adminUserId,
        entityType,
        entityId,
        data: data as Prisma.InputJsonValue,
      },
    });
  }

  async lockReferrer({ referrerId }: { referrerId: string }): Promise<LockedReferrer | null> {
    const [row] = await this.db().$queryRaw<LockedReferrer[]>`
      SELECT r.id, r.user_id AS "userId", r.status::text AS status, u.status::text AS "userStatus"
      FROM referrers r JOIN users u ON u.id = r.user_id
      WHERE r.id = ${referrerId}::uuid
      FOR UPDATE OF r`;
    return row ?? null;
  }

  async lockCommission({
    commissionId,
  }: {
    commissionId: string;
  }): Promise<LockedCommission | null> {
    const found = await this.db().commission.findUnique({
      where: { id: commissionId },
      select: { referrerId: true },
    });
    if (!found) return null;
    // G2: Referrer → Payout → Commission. Com o Referrer travado, o payoutId
    // da comissão não muda (o pedido e o Pagar também travam o Referrer).
    await this.db()
      .$queryRaw`SELECT id FROM referrers WHERE id = ${found.referrerId}::uuid FOR UPDATE`;
    const [link] = await this.db().$queryRaw<{ payoutId: string | null }[]>`
      SELECT payout_id AS "payoutId" FROM commissions WHERE id = ${commissionId}::uuid`;
    const [payout] = link?.payoutId
      ? await this.db().$queryRaw<{ status: LockedCommission['payoutStatus'] }[]>`
          SELECT status::text AS status FROM payouts WHERE id = ${link.payoutId}::uuid FOR UPDATE`
      : [];
    // O weddingBlocked é só leitura (o FOR UPDATE trava só a comissão): o
    // bloqueio do casamento trava o Wedding antes do Referrer, e travá-lo aqui
    // inverteria a ordem (G2). Serve ao aviso do modal (decisão 284(3)).
    const [row] = await this.db().$queryRaw<Omit<LockedCommission, 'payoutStatus'>[]>`
      SELECT c.id, c.referrer_id AS "referrerId", c.status::text AS status,
             c.amount_cents AS "amountCents", c.available_at AS "availableAt",
             c.payout_id AS "payoutId",
             (SELECT w.blocked_at IS NOT NULL FROM weddings w WHERE w.id = c.wedding_id)
               AS "weddingBlocked"
      FROM commissions c WHERE c.id = ${commissionId}::uuid FOR UPDATE`;
    return row ? { ...row, payoutStatus: payout?.status ?? null } : null;
  }

  async blockReferrer({
    referrer,
    adminUserId,
    reason,
    now,
  }: {
    referrer: LockedReferrer;
    adminUserId: string;
    reason: string;
    now: Date;
  }): Promise<{ heldPayoutIds: string[] }> {
    const tx = this.db();
    await tx.user.update({ where: { id: referrer.userId }, data: { status: 'blocked' } });
    await tx.referrer.update({ where: { id: referrer.id }, data: { status: 'blocked' } });
    // As sessões caem (decisão 68).
    await tx.session.updateMany({
      where: { userId: referrer.userId, revokedAt: null },
      data: { revokedAt: now },
    });
    const held = await tx.payout.findMany({
      where: { referrerId: referrer.id, status: 'requested' },
      select: { id: true },
    });
    if (held.length > 0)
      await tx.payout.updateMany({
        where: { id: { in: held.map(({ id }) => id) } },
        data: { status: 'held', holdReason: 'referrer_blocked' },
      });
    await this.log({
      action: 'referrer.blocked',
      entityType: 'referrer',
      entityId: referrer.id,
      adminUserId,
      data: { reason, heldPayoutIds: held.map(({ id }) => id) },
      now,
    });
    return { heldPayoutIds: held.map(({ id }) => id) };
  }

  async unblockReferrer({
    referrer,
    adminUserId,
    reason,
    now,
  }: {
    referrer: LockedReferrer;
    adminUserId: string;
    reason: string;
    now: Date;
  }): Promise<void> {
    const tx = this.db();
    await tx.user.update({ where: { id: referrer.userId }, data: { status: 'active' } });
    await tx.referrer.update({ where: { id: referrer.id }, data: { status: 'active' } });
    await this.log({
      action: 'referrer.unblocked',
      entityType: 'referrer',
      entityId: referrer.id,
      adminUserId,
      data: { reason },
      now,
    });
  }

  async blockCommission({
    commission,
    adminUserId,
    reason,
    now,
  }: {
    commission: LockedCommission;
    adminUserId: string;
    reason: string;
    now: Date;
  }): Promise<{ heldPayoutId: string | null }> {
    const tx = this.db();
    await tx.commission.update({
      where: { id: commission.id },
      data: { status: 'blocked', blockReason: 'admin' },
    });
    let heldPayoutId: string | null = null;
    if (commission.payoutId) {
      const held = await tx.payout.updateMany({
        where: { id: commission.payoutId, status: 'requested' },
        data: { status: 'held', holdReason: 'commission_blocked' },
      });
      if (held.count > 0) heldPayoutId = commission.payoutId;
    }
    await this.log({
      action: 'commission.blocked',
      entityType: 'commission',
      entityId: commission.id,
      adminUserId,
      data: {
        reason,
        referrerId: commission.referrerId,
        amountCents: commission.amountCents,
        previousStatus: commission.status,
        heldPayoutId,
      },
      now,
    });
    return { heldPayoutId };
  }

  async unblockCommission({
    commission,
    status,
    adminUserId,
    reason,
    now,
  }: {
    commission: LockedCommission;
    status: 'pending' | 'available';
    adminUserId: string;
    reason: string;
    now: Date;
  }): Promise<void> {
    await this.db().commission.update({
      where: { id: commission.id },
      data: { status, blockReason: null },
    });
    await this.log({
      action: 'commission.unblocked',
      entityType: 'commission',
      entityId: commission.id,
      adminUserId,
      data: {
        reason,
        referrerId: commission.referrerId,
        amountCents: commission.amountCents,
        status,
      },
      now,
    });
  }

  async addAdjustment({
    referrerId,
    amountCents,
    reason,
    adminUserId,
    openAlert,
    now,
  }: {
    referrerId: string;
    amountCents: number;
    reason: string;
    adminUserId: string;
    openAlert: boolean;
    now: Date;
  }): Promise<{ adjustmentId: string }> {
    const tx = this.db();
    const adjustmentId = uuidV7({ now: now.getTime() });
    await tx.commissionAdjustment.create({
      data: {
        id: adjustmentId,
        createdAt: now,
        referrerId,
        amountCents,
        reason: 'manual',
        note: reason,
        createdByUserId: adminUserId,
      },
    });
    await this.log({
      action: 'commission.adjusted',
      entityType: 'referrer',
      entityId: referrerId,
      adminUserId,
      data: { reason, amountCents, adjustmentId },
      now,
    });
    if (openAlert)
      await tx.alert.create({
        data: {
          type: 'manual_adjustment',
          entityType: 'commission_adjustment',
          entityId: adjustmentId,
          data: { referrerId, amountCents, adminUserId },
        },
      });
    return { adjustmentId };
  }

  async correctTaxId({
    referrerId,
    type,
    encrypted,
    hash,
    version,
    adminUserId,
    reason,
    now,
  }: {
    referrerId: string;
    type: 'cpf' | 'cnpj';
    encrypted: string;
    hash: string;
    version: number;
    adminUserId: string;
    reason: string;
    now: Date;
  }): Promise<'ok' | 'in_use'> {
    const tx = this.db();
    const other = await tx.referrer.count({
      where: { taxIdHash: hash, id: { not: referrerId } },
    });
    if (other > 0) return 'in_use';
    // O índice único decide a corrida com outro cadastro do mesmo documento.
    const saved = await tx.$executeRaw`
      UPDATE referrers
      SET tax_id_type = ${type}::tax_id_type, tax_id_encrypted = ${encrypted},
          tax_id_hash = ${hash}, tax_id_hash_version = ${version}, updated_at = ${now}
      WHERE id = ${referrerId}::uuid
        AND NOT EXISTS (SELECT 1 FROM referrers o WHERE o.tax_id_hash = ${hash} AND o.id <> ${referrerId}::uuid)`;
    if (saved === 0) return 'in_use';
    // A autoindicação de novo (Comissões RN03; B6-7): as pendentes e disponíveis
    // pagas por este documento ficam bloqueadas, e o repasse pedido, retido.
    // G2: os repasses abertos dela antes das comissões.
    await tx.$queryRaw`
      SELECT id FROM payouts WHERE referrer_id = ${referrerId}::uuid
        AND status IN ('requested', 'held') FOR UPDATE`;
    const blocked = await tx.$queryRaw<{ id: string; payout_id: string | null }[]>`
      UPDATE commissions c
      SET status = 'blocked', block_reason = 'self_referral', updated_at = ${now}
      FROM payments p
      WHERE p.id = c.payment_id AND c.referrer_id = ${referrerId}::uuid
        AND c.status IN ('pending', 'available') AND p.payer_tax_id_hash = ${hash}
        -- A do repasse em processamento ou pago segue com ele (Repasse B6-4).
        AND (c.payout_id IS NULL OR EXISTS (
          SELECT 1 FROM payouts o WHERE o.id = c.payout_id AND o.status IN ('requested', 'held')))
      RETURNING c.id, c.payout_id`;
    const payoutIds = [...new Set(blocked.map((row) => row.payout_id).filter((id) => id !== null))];
    if (payoutIds.length > 0)
      await tx.payout.updateMany({
        where: { id: { in: payoutIds }, status: 'requested' },
        data: { status: 'held', holdReason: 'commission_blocked' },
      });
    await this.log({
      action: 'referrer.tax_id_corrected',
      entityType: 'referrer',
      entityId: referrerId,
      adminUserId,
      data: {
        reason,
        taxIdType: type,
        selfReferralCommissionIds: blocked.map((row) => row.id),
      },
      now,
    });
    return 'ok';
  }
}
