import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../../generated/prisma/client';
import { BackofficeTransaction } from '../../../../shared/database/backoffice-transaction';
import { uuidV7 } from '../../../../shared/ids/uuid-v7';
import type { PixKeyType } from '../../../referral/domain/payout-data';
import type { LockedPayout, PayoutLedger } from '../../application/ports/payout-ledger.port';

/** As escritas do repasse, na transação corrente do backoffice (fora da RLS). */
@Injectable()
export class PrismaPayoutLedger implements PayoutLedger {
  constructor(private readonly transaction: BackofficeTransaction) {}

  private db(): Prisma.TransactionClient {
    return this.transaction.client();
  }

  async lock({ payoutId }: { payoutId: string }): Promise<LockedPayout | null> {
    const target = await this.db().payout.findUnique({
      where: { id: payoutId },
      select: { referrerId: true },
    });
    if (!target) return null;
    const [referrer] = await this.db().$queryRaw<
      { user_id: string; status: LockedPayout['referrerStatus'] }[]
    >`SELECT user_id::text, status::text AS status FROM referrers
      WHERE id = ${target.referrerId}::uuid FOR UPDATE`;
    const [payout] = await this.db().$queryRaw<
      {
        status: LockedPayout['status'];
        amount_cents: number;
        external_ref: string;
        key_type: PixKeyType;
        key_encrypted: string;
      }[]
    >`SELECT p.status::text AS status, p.amount_cents, p.external_ref,
             k.key_type::text AS key_type, k.key_encrypted
      FROM payouts p JOIN referrer_pix_keys k ON k.id = p.pix_key_id
      WHERE p.id = ${payoutId}::uuid FOR UPDATE OF p`;
    const [items] = await this.db().$queryRaw<{ cents: number }[]>`
      SELECT (COALESCE((SELECT sum(c.amount_cents) FROM commissions c
                        WHERE c.payout_id = ${payoutId}::uuid AND c.status <> 'reversed'), 0)
            + COALESCE((SELECT sum(a.amount_cents) FROM commission_adjustments a
                        WHERE a.payout_id = ${payoutId}::uuid), 0))::int AS cents`;
    const pending = await this.db().referrerPixKey.count({
      where: { referrerId: target.referrerId, status: 'pending_activation' },
    });
    return {
      id: payoutId,
      status: payout.status,
      amountCents: payout.amount_cents,
      externalRef: payout.external_ref,
      referrerId: target.referrerId,
      referrerUserId: referrer.user_id,
      referrerStatus: referrer.status,
      pixKeyChangePending: pending > 0,
      itemsCents: items.cents,
      pixKey: { type: payout.key_type, encrypted: payout.key_encrypted },
    };
  }

  async markProcessing({
    payoutId,
    paidByUserId,
    idempotencyKey,
    now,
  }: {
    payoutId: string;
    paidByUserId: string;
    idempotencyKey: string;
    now: Date;
  }): Promise<void> {
    const payout = await this.db().payout.update({
      where: { id: payoutId },
      data: { status: 'processing', processingAt: now, paidByUserId, lastError: null },
      select: { amountCents: true, referrerId: true },
    });
    await this.db().applicationLog.create({
      data: {
        createdAt: now,
        action: 'payout.processing',
        actorKind: 'admin',
        actorUserId: paidByUserId,
        entityType: 'payout',
        entityId: payoutId,
        data: { amountCents: payout.amountCents, referrerId: payout.referrerId, idempotencyKey },
      },
    });
  }

  async markPaid({
    payoutId,
    transferId,
    now,
  }: {
    payoutId: string;
    transferId: string;
    now: Date;
  }): Promise<void> {
    await this.db().payout.update({
      where: { id: payoutId },
      data: { status: 'paid', paidAt: now, gatewayTransferId: transferId, lastError: null },
    });
    // B6-4: a comissão estornada durante o Pix foi paga; o ajuste negativo
    // abate o próximo repasse (Comissões RN05), uma vez só.
    const refunded = await this.db().$queryRaw<
      { id: string; referrer_id: string; amount_cents: number; chargeback: boolean }[]
    >`SELECT c.id::text, c.referrer_id::text, c.amount_cents,
             p.refund_origin = 'chargeback' AS chargeback
      FROM commissions c JOIN payments p ON p.id = c.payment_id
      WHERE c.payout_id = ${payoutId}::uuid AND c.status IN ('available', 'held')
        AND p.status = 'refunded'
        AND NOT EXISTS (SELECT 1 FROM commission_adjustments a
                        WHERE a.commission_id = c.id AND a.reason IN ('refund', 'chargeback'))`;
    if (refunded.length > 0)
      await this.db().commissionAdjustment.createMany({
        data: refunded.map((row, index) => ({
          id: uuidV7({ now: now.getTime() + index }),
          createdAt: now,
          referrerId: row.referrer_id,
          commissionId: row.id,
          amountCents: -row.amount_cents,
          reason: row.chargeback ? ('chargeback' as const) : ('refund' as const),
        })),
      });
    // Também a retida (pedido de reembolso ou contestação durante o Pix): no
    // repasse em processamento, vale a RN05 (B6-4), e ela foi paga.
    await this.db().commission.updateMany({
      where: { payoutId, status: { in: ['available', 'held'] } },
      data: { status: 'paid', paidAt: now },
    });
  }

  async markFailed({
    payoutId,
    reason,
    now,
  }: {
    payoutId: string;
    reason: string;
    now: Date;
  }): Promise<void> {
    await this.db().payout.update({
      where: { id: payoutId },
      data: { status: 'requested', processingAt: null, paidByUserId: null, lastError: reason },
    });
    // B6-4: com o Pix falho, a comissão estornada durante ele vira reversed;
    // o trigger payout_follows_commission retém o repasse (RN06 (a)).
    await this.db().$executeRaw`
      UPDATE commissions c SET status = 'reversed', reversed_at = ${now}, updated_at = ${now}
      FROM payments p
      WHERE p.id = c.payment_id AND c.payout_id = ${payoutId}::uuid
        AND c.status IN ('available', 'held') AND p.status = 'refunded'`;
    // Uma comissão ainda retida (a contestação ou o reembolso em curso) deixa o
    // repasse retido, como se tivesse retido em solicitado (RN06; decisão 247(3)).
    await this.db().$executeRaw`
      UPDATE payouts SET status = 'held', updated_at = ${now},
        hold_reason = CASE WHEN EXISTS (
            SELECT 1 FROM commissions c JOIN payments p ON p.id = c.payment_id
            WHERE c.payout_id = ${payoutId}::uuid AND c.status = 'held' AND p.status = 'disputed')
          THEN 'dispute'::payout_hold_reason ELSE 'refund'::payout_hold_reason END
      WHERE id = ${payoutId}::uuid AND status = 'requested'
        AND EXISTS (SELECT 1 FROM commissions c
                    WHERE c.payout_id = ${payoutId}::uuid AND c.status = 'held')`;
  }

  async paidWithKey({
    payoutId,
    idempotencyKey,
  }: {
    payoutId: string;
    idempotencyKey: string;
  }): Promise<boolean> {
    const count = await this.db().applicationLog.count({
      where: {
        action: 'payout.processing',
        entityType: 'payout',
        entityId: payoutId,
        data: { path: ['idempotencyKey'], equals: idempotencyKey },
      },
    });
    return count > 0;
  }

  async recordRetry({
    payoutId,
    adminUserId,
    gatewayStatus,
    result,
    now,
  }: {
    payoutId: string;
    adminUserId: string;
    gatewayStatus: string;
    result: string;
    now: Date;
  }): Promise<void> {
    const payout = await this.db().payout.findUniqueOrThrow({
      where: { id: payoutId },
      select: { amountCents: true, referrerId: true },
    });
    await this.db().applicationLog.create({
      data: {
        createdAt: now,
        action: 'payout.retried',
        actorKind: 'admin',
        actorUserId: adminUserId,
        entityType: 'payout',
        entityId: payoutId,
        data: {
          amountCents: payout.amountCents,
          referrerId: payout.referrerId,
          gatewayStatus,
          result,
        },
      },
    });
  }

  async markStuck({
    payoutId,
    error,
  }: {
    payoutId: string;
    error: string;
    now: Date;
  }): Promise<void> {
    await this.db().payout.update({ where: { id: payoutId }, data: { lastError: error } });
  }

  async openFailedAlert({ payoutId, reason }: { payoutId: string; reason: string }): Promise<void> {
    await this.db().$executeRaw`
      INSERT INTO alerts (id, type, entity_type, entity_id, data)
      VALUES (${uuidV7()}::uuid, 'payout_failed', 'payout', ${payoutId},
              ${JSON.stringify({ reason })}::jsonb)
      ON CONFLICT (type, entity_type, entity_id) WHERE status = 'open' DO NOTHING`;
  }

  async processingPayoutIds({ payoutId }: { payoutId?: string }): Promise<string[]> {
    const rows = await this.db().payout.findMany({
      where: { status: 'processing', ...(payoutId ? { id: payoutId } : {}) },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async payoutIdByReference({ externalRef }: { externalRef: string }): Promise<string | null> {
    const payout = await this.db().payout.findUnique({
      where: { externalRef },
      select: { id: true },
    });
    return payout?.id ?? null;
  }

  async recipient({
    userId,
  }: {
    userId: string;
  }): Promise<{ email: string; firstName: string | null }> {
    const user = await this.db().user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, name: true },
    });
    return { email: user.email, firstName: user.name?.trim().split(/\s+/)[0] || null };
  }
}
