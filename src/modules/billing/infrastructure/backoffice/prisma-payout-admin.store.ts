import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../../generated/prisma/client';
import { BackofficeTransaction } from '../../../../shared/database/backoffice-transaction';
import type {
  PayoutAdminStore,
  PayoutQueueRow,
  PayoutQueueTab,
  RejectResult,
  ReleaseResult,
} from '../../application/ports/payout-admin.store.port';

const PAGE_SIZE = 50;
const TAB_STATUSES: Record<PayoutQueueTab, Prisma.PayoutWhereInput['status']> = {
  // O em processamento fica em Solicitados, com o Tentar o Pix de novo.
  requested: { in: ['requested', 'processing'] },
  held: 'held',
  history: { in: ['paid', 'rejected'] },
};

const firstName = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] ?? '';

/** O que entra no valor do pedido: as comissões que não saíram, mais os ajustes. */
const RELEASABLE = ['pending', 'available'] as const;

/** Na transação corrente da BackofficeTransaction (kore_backoffice). */
@Injectable()
export class PrismaPayoutAdminStore implements PayoutAdminStore {
  constructor(private readonly transaction: BackofficeTransaction) {}

  private db() {
    return this.transaction.client();
  }

  async queue({
    tab,
    referrerId,
    page,
  }: {
    tab: PayoutQueueTab;
    referrerId?: string;
    page: number;
  }) {
    const where: Prisma.PayoutWhereInput = {
      status: TAB_STATUSES[tab],
      ...(referrerId ? { referrerId } : {}),
    };
    const [total, payouts] = await Promise.all([
      this.db().payout.count({ where }),
      this.db().payout.findMany({
        where,
        orderBy: [{ requestedAt: tab === 'history' ? 'desc' : 'asc' }, { id: 'asc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          status: true,
          amountCents: true,
          pixKeyMasked: true,
          requestedAt: true,
          holdReason: true,
          processingAt: true,
          lastError: true,
          paidAt: true,
          rejectedAt: true,
          rejectReason: true,
          referrer: {
            select: {
              id: true,
              kind: true,
              user: { select: { name: true } },
              planner: { select: { creditName: true } },
              pixKeys: {
                where: { status: 'pending_activation' },
                select: { activeFrom: true },
                take: 1,
              },
            },
          },
          commissions: {
            select: {
              amountCents: true,
              status: true,
              wedding: {
                select: { partners: { orderBy: { slot: 'asc' }, select: { displayName: true } } },
              },
            },
          },
          adjustments: { select: { amountCents: true } },
        },
      }),
    ]);
    const items: PayoutQueueRow[] = payouts.map((payout) => {
      const releasable =
        payout.commissions
          .filter((c) => (RELEASABLE as readonly string[]).includes(c.status))
          .reduce((sum, c) => sum + c.amountCents, 0) +
        payout.adjustments.reduce((sum, a) => sum + a.amountCents, 0);
      return {
        id: payout.id,
        status: payout.status,
        referrer: {
          id: payout.referrer.id,
          kind: payout.referrer.kind,
          name: payout.referrer.planner?.creditName ?? payout.referrer.user.name ?? '',
        },
        amountCents: payout.amountCents,
        pixKeyMasked: payout.pixKeyMasked,
        requestedAt: payout.requestedAt,
        holdReason: payout.holdReason,
        heldCommissions: payout.commissions
          .filter(
            (c) => !(RELEASABLE as readonly string[]).includes(c.status) && c.status !== 'paid',
          )
          .map((c) => ({
            coupleNames: c.wedding.partners.length
              ? c.wedding.partners.map((p) => firstName(p.displayName)).join(' & ')
              : null,
            amountCents: c.amountCents,
            status: c.status,
          })),
        pixKeyActiveFrom: payout.referrer.pixKeys[0]?.activeFrom ?? null,
        releaseAmountCents: payout.status === 'held' ? releasable : null,
        processingAt: payout.processingAt,
        lastError: payout.lastError,
        paidAt: payout.paidAt,
        rejectedAt: payout.rejectedAt,
        rejectReason: payout.rejectReason,
      };
    });
    return { items, total, pageSize: PAGE_SIZE };
  }

  /** Referrer → Payout (RN18); nulo sem o repasse. */
  private async lock(payoutId: string) {
    const target = await this.db().payout.findUnique({
      where: { id: payoutId },
      select: { referrerId: true },
    });
    if (!target) return null;
    const [referrer] = await this.db().$queryRaw<{ userId: string; status: string }[]>`
      SELECT user_id::text AS "userId", status::text AS status FROM referrers
      WHERE id = ${target.referrerId}::uuid FOR UPDATE`;
    const [payout] = await this.db().$queryRaw<{ status: string; amountCents: number }[]>`
      SELECT status::text AS status, amount_cents AS "amountCents" FROM payouts
      WHERE id = ${payoutId}::uuid FOR UPDATE`;
    await this.db().$queryRaw`
      SELECT id FROM commissions WHERE payout_id = ${payoutId}::uuid ORDER BY id FOR UPDATE`;
    return { referrerId: target.referrerId, referrer, payout };
  }

  private async log({
    action,
    payoutId,
    byUserId,
    data,
    now,
  }: {
    action: string;
    payoutId: string;
    byUserId: string;
    data: Record<string, unknown>;
    now: Date;
  }) {
    await this.db().applicationLog.createMany({
      data: [
        {
          createdAt: now,
          action,
          actorKind: 'admin',
          actorUserId: byUserId,
          entityType: 'payout',
          entityId: payoutId,
          data: data as Prisma.InputJsonValue,
        },
      ],
    });
  }

  async reject({
    payoutId,
    byUserId,
    reason,
    now,
  }: {
    payoutId: string;
    byUserId: string;
    reason: string;
    now: Date;
  }): Promise<RejectResult> {
    const locked = await this.lock(payoutId);
    if (!locked) return { result: 'not_found' };
    if (!['requested', 'held'].includes(locked.payout.status))
      return { result: 'conflict', status: locked.payout.status };
    // As comissões e os ajustes voltam ao saldo; o recusado não conta para os 30 dias.
    await this.db().commission.updateMany({ where: { payoutId }, data: { payoutId: null } });
    await this.db().commissionAdjustment.updateMany({
      where: { payoutId },
      data: { payoutId: null },
    });
    await this.db().payout.update({
      where: { id: payoutId },
      data: { status: 'rejected', holdReason: null, rejectedAt: now, rejectReason: reason },
    });
    await this.log({
      action: 'payout.rejected',
      payoutId,
      byUserId,
      data: { amountCents: locked.payout.amountCents, reason },
      now,
    });
    return { result: 'rejected', referrerUserId: locked.referrer.userId };
  }

  async release({
    payoutId,
    byUserId,
    now,
  }: {
    payoutId: string;
    byUserId: string;
    now: Date;
  }): Promise<ReleaseResult> {
    const locked = await this.lock(payoutId);
    if (!locked) return { result: 'not_found' };
    if (locked.payout.status !== 'held')
      return { result: 'conflict', status: locked.payout.status };
    if (locked.referrer.status !== 'active') return { result: 'referrer_blocked' };
    const pendingKey = await this.db().referrerPixKey.count({
      where: { referrerId: locked.referrerId, status: 'pending_activation' },
    });
    if (pendingKey > 0) return { result: 'pix_key_change_pending' };
    const commissions = await this.db().commission.findMany({
      where: { payoutId },
      select: { id: true, status: true, amountCents: true },
    });
    // Em estorno ou em contestação: o desfecho decide; o trigger devolve o pedido.
    if (commissions.some((c) => c.status === 'held')) return { result: 'still_held' };
    const adjustments = await this.db().commissionAdjustment.aggregate({
      where: { payoutId },
      _sum: { amountCents: true },
    });
    const kept = commissions.filter((c) => (RELEASABLE as readonly string[]).includes(c.status));
    const amountCents =
      kept.reduce((sum, c) => sum + c.amountCents, 0) + (adjustments._sum.amountCents ?? 0);
    const settings = await this.db().referralSettings.findFirstOrThrow({
      select: { payoutMinCents: true },
    });
    if (amountCents < settings.payoutMinCents)
      return { result: 'below_minimum', amountCents, minimumCents: settings.payoutMinCents };
    // As estornadas e as bloqueadas saem do pedido; o valor é recalculado (RN09).
    const dropped = commissions.filter((c) => !kept.includes(c)).map((c) => c.id);
    if (dropped.length > 0)
      await this.db().commission.updateMany({
        where: { id: { in: dropped } },
        data: { payoutId: null },
      });
    await this.db().payout.update({
      where: { id: payoutId },
      data: { status: 'requested', holdReason: null, amountCents },
    });
    await this.log({
      action: 'payout.released',
      payoutId,
      byUserId,
      data: { amountCentsBefore: locked.payout.amountCents, amountCentsAfter: amountCents },
      now,
    });
    return { result: 'released', amountCents };
  }
}
