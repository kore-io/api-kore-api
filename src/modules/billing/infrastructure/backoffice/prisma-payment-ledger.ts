import { Injectable } from '@nestjs/common';
import type { AlertType, Prisma } from '../../../../generated/prisma/client';
import { BackofficeTransaction } from '../../../../shared/database/backoffice-transaction';
import { uuidV7 } from '../../../../shared/ids/uuid-v7';
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
      }[]
    >`
      SELECT id, status::text AS status, blocked_at AS "blockedAt",
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
      },
    });
    const ledgerWedding: LedgerWedding = {
      ...wedding,
      deletionScheduledFor: day(wedding.deletionScheduledFor),
      eventDate: day(wedding.eventDate),
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
    userIds,
    payload,
    now,
  }: {
    weddingId: string;
    paymentId: string;
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
        groupKey: `billing:${paymentId}`,
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
