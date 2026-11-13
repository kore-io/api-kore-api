import { Injectable } from '@nestjs/common';
import type { AlertType, Prisma } from '../../../../generated/prisma/client';
import { BackofficeTransaction } from '../../../../shared/database/backoffice-transaction';
import { uuidV7 } from '../../../../shared/ids/uuid-v7';
import { newCommission } from '../../domain/commission';
import type {
  BillingRecipient,
  LedgerLogEntry,
  LedgerPayment,
  LedgerWedding,
  PaymentLedger,
} from '../../application/ports/payment-ledger.port';

const day = (value: Date | null): string | null => value?.toISOString().slice(0, 10) ?? null;
const firstName = (value: string | null | undefined): string =>
  (value ?? '').trim().split(/\s+/)[0] ?? '';

/**
 * As escritas do dinheiro pelo worker, na transação corrente da
 * BackofficeTransaction (kore_backoffice, fora da RLS por casamento).
 */
@Injectable()
export class PrismaPaymentLedger implements PaymentLedger {
  constructor(private readonly transaction: BackofficeTransaction) {}

  private db(): Prisma.TransactionClient {
    return this.transaction.client();
  }

  async lock({ paymentId }: { paymentId: string }) {
    const target = await this.db().payment.findUnique({
      where: { id: paymentId },
      select: { weddingId: true },
    });
    if (!target) return null;
    // A ordem única de trava (RN18): Wedding antes de Payment.
    const [wedding] = await this.db().$queryRaw<
      {
        id: string;
        status: string;
        blockedAt: Date | null;
        deletionScheduledFor: Date | null;
        publishedAt: Date | null;
        timezone: string | null;
        eventDate: Date | null;
        endDate: Date | null;
        paidThrough: Date | null;
      }[]
    >`
      SELECT id, status::text AS status, blocked_at AS "blockedAt",
             end_date AS "endDate", paid_through AS "paidThrough",
             deletion_scheduled_for AS "deletionScheduledFor", published_at AS "publishedAt",
             timezone, event_date AS "eventDate"
      FROM weddings WHERE id = ${target.weddingId}::uuid FOR UPDATE`;
    await this.db().$queryRaw`SELECT 1 FROM payments WHERE id = ${paymentId}::uuid FOR UPDATE`;
    const payment = await this.db().payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: {
        id: true,
        weddingId: true,
        kind: true,
        status: true,
        method: true,
        installments: true,
        amountCents: true,
        periodStart: true,
        periodEnd: true,
        appliedAt: true,
        createdByUserId: true,
        gatewayPaymentId: true,
        shortCode: true,
        dueAt: true,
        createdAt: true,
        cardLast4: true,
        refundOrigin: true,
        refundRequestedAt: true,
        refundAttempts: true,
        refundLastError: true,
        refundFailedAt: true,
        disputedAt: true,
        disputeResolvedAt: true,
      },
    });
    const ledgerWedding: LedgerWedding = {
      ...wedding,
      deletionScheduledFor: day(wedding.deletionScheduledFor),
      eventDate: day(wedding.eventDate),
      endDate: day(wedding.endDate),
      paidThrough: day(wedding.paidThrough),
    };
    const ledgerPayment: LedgerPayment = {
      ...payment,
      periodStart: day(payment.periodStart) ?? '',
      periodEnd: day(payment.periodEnd) ?? '',
    };
    return { wedding: ledgerWedding, payment: ledgerPayment };
  }

  async otherPublicationApplied({
    weddingId,
    paymentId,
  }: {
    weddingId: string;
    paymentId: string;
  }): Promise<boolean> {
    const other = await this.db().payment.findFirst({
      where: {
        weddingId,
        kind: 'publication',
        id: { not: paymentId },
        status: { in: ['paid', 'refund_requested', 'disputed'] },
        appliedAt: { not: null },
      },
      select: { id: true },
    });
    return other !== null;
  }

  async markPaid(input: {
    paymentId: string;
    paidAt: Date;
    chargedCents: number;
    feeCents: number | null;
    netCents: number | null;
    gatewayPaymentId: string;
    cardLast4: string | null;
  }): Promise<void> {
    await this.db().payment.update({
      where: { id: input.paymentId },
      data: {
        status: 'paid',
        paidAt: input.paidAt,
        gatewayChargedCents: input.chargedCents,
        gatewayFeeCents: input.feeCents,
        netCents: input.netCents,
        gatewayPaymentId: input.gatewayPaymentId,
        ...(input.cardLast4 ? { cardLast4: input.cardLast4 } : {}),
        failureReason: null,
      },
    });
  }

  async markApplied({ paymentId, now }: { paymentId: string; now: Date }): Promise<void> {
    await this.db().payment.update({ where: { id: paymentId }, data: { appliedAt: now } });
  }

  async markFailed({
    paymentId,
    reason,
    gatewayPaymentId,
  }: {
    paymentId: string;
    reason: string;
    gatewayPaymentId: string;
  }): Promise<void> {
    await this.db().payment.updateMany({
      where: { id: paymentId, status: 'pending' },
      data: { status: 'failed', failureReason: reason, gatewayPaymentId },
    });
  }

  async markCanceled({ paymentId, now }: { paymentId: string; now: Date }): Promise<void> {
    await this.db().payment.updateMany({
      where: { id: paymentId, status: 'pending' },
      data: { status: 'canceled', canceledAt: now },
    });
  }

  async publish({
    weddingId,
    endDate,
    publishedByUserId,
    now,
  }: {
    weddingId: string;
    endDate: string;
    publishedByUserId: string | null;
    now: Date;
  }): Promise<void> {
    const end = new Date(`${endDate}T00:00:00Z`);
    // publishedAt só na primeira vez; a carência lê a endDate (decisão 230, D11).
    await this.db().$executeRaw`
      UPDATE weddings
      SET status = 'published', published_at = COALESCE(published_at, ${now}),
          end_date = ${end}, paid_through = ${end}, publication_source = 'payment',
          published_by_user_id = ${publishedByUserId}::uuid, updated_at = ${now}
      WHERE id = ${weddingId}::uuid AND status = 'draft'`;
  }

  async extend({
    weddingId,
    paymentId,
    endDate,
    now,
  }: {
    weddingId: string;
    paymentId: string;
    endDate: string;
    now: Date;
  }): Promise<void> {
    const end = new Date(`${endDate}T00:00:00Z`);
    // As datas de antes, na confirmação (Pagamentos e arrependimento RN03; B3-5).
    await this.db().$executeRaw`
      UPDATE payments p
      SET previous_end_date = w.end_date, previous_paid_through = w.paid_through
      FROM weddings w
      WHERE p.id = ${paymentId}::uuid AND w.id = p.wedding_id`;
    await this.db().$executeRaw`
      UPDATE weddings
      SET end_date = ${end}, paid_through = ${end},
          status = CASE
            WHEN status = 'grace' AND event_date >= (${now}::timestamptz AT TIME ZONE
                   coalesce(timezone, 'America/Sao_Paulo'))::date THEN 'published'::wedding_status
            WHEN status IN ('grace', 'expired') THEN 'post_event'::wedding_status
            ELSE status END,
          grace_until = NULL, expired_at = NULL, purge_at = NULL, purge_notice_sent_at = NULL,
          updated_at = ${now}
      WHERE id = ${weddingId}::uuid`;
  }

  async billingRecipients({ weddingId }: { weddingId: string }): Promise<BillingRecipient[]> {
    const owners = await this.db().membership.findMany({
      where: { weddingId, role: 'owner', removedAt: null, user: { status: 'active' } },
      select: {
        userId: true,
        user: {
          select: {
            email: true,
            name: true,
            partners: { where: { weddingId }, select: { displayName: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return owners.map(({ userId, user }) => ({
      userId,
      email: user.email,
      firstName: firstName(user.partners[0]?.displayName ?? user.name),
    }));
  }

  async partnerNames({ weddingId }: { weddingId: string }): Promise<[string, string]> {
    const partners = await this.db().partner.findMany({
      where: { weddingId },
      orderBy: { slot: 'asc' },
      select: { displayName: true },
    });
    return [firstName(partners[0]?.displayName), firstName(partners[1]?.displayName)];
  }

  async notifyBilling({
    weddingId,
    paymentId,
    event,
    userIds,
    payload,
    now,
  }: {
    weddingId: string;
    paymentId: string;
    event: 'payment_confirmed' | 'refund_completed';
    userIds: string[];
    payload: Record<string, unknown>;
    now: Date;
  }): Promise<void> {
    if (userIds.length === 0) return;
    await this.db().notification.createMany({
      data: userIds.map((userId) => ({
        id: uuidV7({ now: now.getTime() }),
        userId,
        weddingId,
        type: 'billing' as const,
        groupKey:
          event === 'payment_confirmed' ? `billing:${paymentId}` : `billing:${paymentId}:refund`,
        payload: [payload] as Prisma.InputJsonValue,
        createdAt: now,
        updatedAt: now,
      })),
      skipDuplicates: true,
    });
  }

  async notifyEndDateNotice({
    weddingId,
    notice,
    endDate,
    userIds,
    payload,
    now,
  }: {
    weddingId: string;
    notice: 'end_date_in_7_days' | 'grace_day_1' | 'grace_day_5' | 'expired';
    endDate: string;
    userIds: string[];
    payload: Record<string, unknown>;
    now: Date;
  }): Promise<void> {
    if (userIds.length === 0) return;
    await this.db().notification.createMany({
      data: userIds.map((userId) => ({
        id: uuidV7({ now: now.getTime() }),
        userId,
        weddingId,
        type: 'billing' as const,
        groupKey: `billing:${notice}:${endDate}`,
        payload: [payload] as Prisma.InputJsonValue,
        createdAt: now,
        updatedAt: now,
      })),
      skipDuplicates: true,
    });
  }

  async notifyWeddingPublished({
    weddingId,
    now,
  }: {
    weddingId: string;
    now: Date;
  }): Promise<void> {
    // No máximo 2 pessoas: a indicadora e a cerimonialista colaboradora.
    const ids = [uuidV7({ now: now.getTime() }), uuidV7({ now: now.getTime() })];
    await this.db().$queryRaw`
      SELECT notify_wedding_published_for(${weddingId}::uuid, ${ids}::uuid[])`;
  }

  async requestAutomaticRefund({ paymentId, now }: { paymentId: string; now: Date }) {
    await this.db().payment.updateMany({
      where: { id: paymentId, status: 'paid', appliedAt: null },
      data: { status: 'refund_requested', refundOrigin: 'automatic', refundRequestedAt: now },
    });
  }

  async countRefundAttempt({ paymentId }: { paymentId: string }): Promise<number> {
    const updated = await this.db().payment.update({
      where: { id: paymentId },
      data: { refundAttempts: { increment: 1 }, refundLastError: null },
      select: { refundAttempts: true },
    });
    return updated.refundAttempts;
  }

  async recordRefundFailure({
    paymentId,
    error,
    gaveUp,
    now,
  }: {
    paymentId: string;
    error: string;
    gaveUp: boolean;
    now: Date;
  }) {
    await this.db().payment.update({
      where: { id: paymentId },
      data: { refundLastError: error.slice(0, 500), ...(gaveUp ? { refundFailedAt: now } : {}) },
    });
  }

  async markRefunded({ paymentId, now }: { paymentId: string; now: Date }) {
    await this.db().payment.updateMany({
      where: { id: paymentId, status: 'refund_requested' },
      data: { status: 'refunded', refundedAt: now },
    });
  }

  sameRefundRequest({
    weddingId,
    refundRequestedAt,
  }: {
    weddingId: string;
    refundRequestedAt: Date;
  }) {
    return this.db().payment.findMany({
      where: { weddingId, refundRequestedAt },
      orderBy: { periodStart: 'asc' },
      select: { id: true, shortCode: true },
    });
  }

  async markDisputed({
    paymentId,
    now,
    deadline,
    keepStatus,
  }: {
    paymentId: string;
    now: Date;
    deadline: string | null;
    keepStatus: boolean;
  }) {
    await this.db().payment.update({
      where: { id: paymentId },
      data: {
        ...(keepStatus ? {} : { status: 'disputed' as const }),
        disputedAt: now,
        disputeDeadline: deadline ? new Date(`${deadline}T00:00:00Z`) : null,
        disputeResolvedAt: null,
      },
    });
  }

  async markDisputeWon({ paymentId, now }: { paymentId: string; now: Date }) {
    await this.db().payment.updateMany({
      where: { id: paymentId, status: 'disputed' },
      data: { status: 'paid', disputeResolvedAt: now },
    });
  }

  async markDisputeLost({ paymentId, now }: { paymentId: string; now: Date }) {
    await this.db().payment.updateMany({
      where: { id: paymentId, status: { in: ['disputed', 'paid'] } },
      data: {
        status: 'refunded',
        refundOrigin: 'chargeback',
        refundedAt: now,
        disputeResolvedAt: now,
      },
    });
    // O estorno já pedido que o banco devolveu pela contestação: refunded,
    // com a origem do pedido (o job de estorno para, sem estornar duas vezes).
    await this.db().payment.updateMany({
      where: { id: paymentId, status: 'refund_requested' },
      data: { status: 'refunded', refundedAt: now, disputeResolvedAt: now },
    });
  }

  async recordBillingNotice({
    weddingId,
    notice,
    endDate,
    now,
  }: {
    weddingId: string;
    notice: 'end_date_in_7_days' | 'grace_day_1' | 'grace_day_5' | 'expired';
    endDate: string;
    now: Date;
  }): Promise<boolean> {
    const rows = await this.db().$queryRaw<{ id: string }[]>`
      INSERT INTO billing_notice_logs (id, wedding_id, notice, end_date, sent_at)
      VALUES (${uuidV7({ now: now.getTime() })}::uuid, ${weddingId}::uuid,
              ${notice}::billing_notice, ${endDate}::date, ${now})
      ON CONFLICT (wedding_id, notice, end_date) DO NOTHING
      RETURNING id::text AS id`;
    return rows.length > 0;
  }

  async createCommission({
    weddingId,
    paymentId,
    now,
  }: {
    weddingId: string;
    paymentId: string;
    now: Date;
  }): Promise<void> {
    // A ordem única (RN18): o Wedding e o Payment já estão travados; agora o Referrer.
    const [row] = await this.db().$queryRaw<
      {
        referrerId: string;
        referrerStatus: 'active' | 'blocked' | 'inactive';
        ratePercent: number;
        referrerTaxIdHash: string | null;
      }[]
    >`
      SELECT r.id::text AS "referrerId", r.status::text AS "referrerStatus",
             r.rate_percent AS "ratePercent", r.tax_id_hash AS "referrerTaxIdHash"
      FROM weddings w JOIN referrers r ON r.id = w.referrer_id
      WHERE w.id = ${weddingId}::uuid
      FOR UPDATE OF r`;
    if (!row) return;
    const payment = await this.db().payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: {
        amountCents: true,
        installmentInterestCents: true,
        payerTaxIdHash: true,
        paidAt: true,
      },
    });
    const commission = newCommission({
      amountCents: payment.amountCents,
      installmentInterestCents: payment.installmentInterestCents,
      ratePercent: row.ratePercent,
      referrerStatus: row.referrerStatus,
      referrerTaxIdHash: row.referrerTaxIdHash,
      payerTaxIdHash: payment.payerTaxIdHash,
    });
    if (commission.kind === 'none') return;
    const settings = await this.db().referralSettings.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { commissionHoldDays: true },
    });
    const paidAt = payment.paidAt ?? now;
    const availableAt = new Date(
      paidAt.getTime() + (settings?.commissionHoldDays ?? 30) * 24 * 60 * 60_000,
    );
    await this.db().commission.createMany({
      data: [
        {
          id: uuidV7({ now: now.getTime() }),
          referrerId: row.referrerId,
          weddingId,
          paymentId,
          baseAmountCents: commission.baseAmountCents,
          ratePercent: row.ratePercent,
          amountCents: commission.amountCents,
          status: commission.status,
          blockReason: commission.blockReason,
          availableAt,
        },
      ],
      skipDuplicates: true,
    });
  }

  async holdCommission({ paymentId }: { paymentId: string; now: Date }): Promise<void> {
    await this.db().commission.updateMany({
      where: { paymentId, status: { in: ['pending', 'available'] } },
      data: { status: 'held' },
    });
  }

  async releaseCommission({ paymentId, now }: { paymentId: string; now: Date }): Promise<void> {
    // Volta pelo availableAt (RN06): a data no fuso de São Paulo, como a liberação.
    await this.db().$executeRaw`
      UPDATE commissions
      SET status = CASE
            WHEN (available_at AT TIME ZONE 'America/Sao_Paulo')::date
                 <= (${now}::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
              THEN 'available'::commission_status
            ELSE 'pending'::commission_status END,
          updated_at = ${now}
      WHERE payment_id = ${paymentId}::uuid AND status = 'held'`;
  }

  async reverseCommission({ paymentId, now }: { paymentId: string; now: Date }): Promise<void> {
    // Fora de repasse (RN05). Dentro de um repasse pedido ou pago: o PR do repasse.
    await this.db().commission.updateMany({
      where: {
        paymentId,
        payoutId: null,
        status: { in: ['pending', 'available', 'blocked', 'held'] },
      },
      data: { status: 'reversed', reversedAt: now },
    });
  }

  async openAlert({
    type,
    weddingId,
    entityType,
    entityId,
    data,
  }: {
    type: AlertType;
    weddingId: string | null;
    entityType: string;
    entityId: string;
    data: Record<string, unknown>;
  }): Promise<void> {
    await this.db().$executeRaw`
      INSERT INTO alerts (id, type, wedding_id, entity_type, entity_id, data)
      VALUES (${uuidV7()}::uuid, ${type}::alert_type, ${weddingId}::uuid, ${entityType},
              ${entityId}, ${JSON.stringify(data)}::jsonb)
      ON CONFLICT (type, entity_type, entity_id) WHERE status = 'open' DO NOTHING`;
  }

  async log({ entry }: { entry: LedgerLogEntry }): Promise<void> {
    await this.db().applicationLog.createMany({
      data: [
        {
          actorKind: 'system',
          action: entry.action,
          weddingId: entry.weddingId,
          entityType: entry.entityType,
          entityId: entry.entityId,
          data: entry.data as Prisma.InputJsonValue | undefined,
        },
      ],
    });
  }
}
