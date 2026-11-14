import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../../generated/prisma/client';
import { BackofficeTransaction } from '../../../../shared/database/backoffice-transaction';
import { uuidV7 } from '../../../../shared/ids/uuid-v7';
import type {
  AdminBillingStore,
  AdminRefundOutcome,
  CourtesyWedding,
} from '../../application/ports/admin-billing.store.port';

/** Pelo kore_backoffice, na transação corrente (decisão 180(5)). */
@Injectable()
export class PrismaAdminBillingStore implements AdminBillingStore {
  constructor(private readonly transaction: BackofficeTransaction) {}

  private db(): Prisma.TransactionClient {
    return this.transaction.client();
  }

  async requestRefund({
    paymentId,
    adminUserId,
    reason,
    now,
  }: {
    paymentId: string;
    adminUserId: string;
    reason: string | null;
    now: Date;
  }): Promise<AdminRefundOutcome> {
    const tx = this.db();
    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      select: { weddingId: true, kind: true, method: true, paidAt: true },
    });
    if (!payment)
      return {
        result: 'not_found',
        paymentIds: [],
        method: 'pix',
        paidAt: null,
        pendingExtensionId: null,
      };
    const [row] = await tx.$queryRaw<{ result: string; payment_ids: string[] }[]>`
      SELECT result, payment_ids::text[] AS payment_ids FROM apply_payment_refund(
        ${payment.weddingId}::uuid, ${paymentId}::uuid, NULL, ${now}::timestamptz,
        ${uuidV7({ now: now.getTime() })}::uuid, 'admin'::refund_origin,
        ${adminUserId}::uuid, false)`;
    const result = (row?.result ?? 'not_found') as AdminRefundOutcome['result'];
    const base = { method: payment.method, paidAt: payment.paidAt };
    if (result !== 'requested')
      return { ...base, result, paymentIds: [], pendingExtensionId: null };
    const rows = await tx.payment.findMany({
      where: { id: { in: row.payment_ids } },
      select: { id: true, kind: true, amountCents: true },
    });
    await tx.applicationLog.createMany({
      data: rows.map((item) => ({
        createdAt: now,
        action: 'payment.refund_requested',
        actorKind: 'admin' as const,
        actorUserId: adminUserId,
        weddingId: payment.weddingId,
        entityType: 'payment',
        entityId: item.id,
        data: {
          refundOrigin: 'admin',
          kind: item.kind,
          amountCents: item.amountCents,
          requestedPaymentId: paymentId,
          ...(reason ? { reason } : {}),
        },
      })),
    });
    const pending =
      payment.kind === 'publication'
        ? await tx.payment.findFirst({
            where: { weddingId: payment.weddingId, kind: 'extension', status: 'pending' },
            select: { id: true },
          })
        : null;
    return {
      ...base,
      result,
      paymentIds: row.payment_ids,
      pendingExtensionId: pending?.id ?? null,
    };
  }

  async clearRefundFailure({
    paymentId,
    weddingId,
    adminUserId,
    reason,
    attempt,
    now,
  }: {
    paymentId: string;
    weddingId: string;
    adminUserId: string;
    reason: string;
    attempt: number;
    now: Date;
  }): Promise<void> {
    const tx = this.db();
    await tx.payment.update({
      where: { id: paymentId },
      data: { refundFailedAt: null, refundLastError: null },
    });
    await tx.applicationLog.create({
      data: {
        createdAt: now,
        action: 'payment.refund_retried',
        actorKind: 'admin',
        actorUserId: adminUserId,
        weddingId,
        entityType: 'payment',
        entityId: paymentId,
        data: { reason, attempt },
      },
    });
  }

  async refundState({
    paymentId,
  }: {
    paymentId: string;
  }): Promise<{ status: string; refundFailed: boolean } | null> {
    const payment = await this.db().payment.findUnique({
      where: { id: paymentId },
      select: { status: true, refundFailedAt: true },
    });
    return payment
      ? { status: payment.status, refundFailed: payment.refundFailedAt !== null }
      : null;
  }

  async receiptKeyOf({ paymentId }: { paymentId: string }): Promise<string | null | undefined> {
    const payment = await this.db().payment.findUnique({
      where: { id: paymentId },
      select: { refundReceiptKey: true },
    });
    return payment ? payment.refundReceiptKey : undefined;
  }

  async lockWeddingForCourtesy({
    weddingId,
  }: {
    weddingId: string;
  }): Promise<CourtesyWedding | null> {
    const [wedding] = await this.db().$queryRaw<CourtesyWedding[]>`
      SELECT status::text AS status, end_date AS "endDate", paid_through AS "paidThrough",
             event_date AS "eventDate", timezone
      FROM weddings WHERE id = ${weddingId}::uuid AND status <> 'purged' FOR UPDATE`;
    return wedding ?? null;
  }

  async recordCourtesy({
    weddingId,
    adminUserId,
    months,
    reason,
    previous,
    previousEndDate,
    periodStart,
    newEndDate,
    now,
  }: {
    weddingId: string;
    adminUserId: string;
    months: number;
    reason: string;
    previous: CourtesyWedding;
    previousEndDate: string;
    periodStart: string;
    newEndDate: string;
    now: Date;
  }): Promise<{ pendingExtensionIds: string[] }> {
    const tx = this.db();
    const end = new Date(`${newEndDate}T00:00:00Z`);
    await tx.courtesyExtension.create({
      data: {
        id: uuidV7({ now: now.getTime() }),
        weddingId,
        adminUserId,
        months,
        reason,
        previousEndDate: new Date(`${previousEndDate}T00:00:00Z`),
        previousPaidThrough: previous.paidThrough,
        newEndDate: end,
        periodStart: new Date(`${periodStart}T00:00:00Z`),
        periodEnd: end,
      },
    });
    // As mesmas transições da extensão paga (Data de saída do ar RN04).
    await tx.$executeRaw`
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
    await tx.applicationLog.create({
      data: {
        createdAt: now,
        action: 'wedding.courtesy_extended',
        actorKind: 'admin',
        actorUserId: adminUserId,
        weddingId,
        entityType: 'wedding',
        entityId: weddingId,
        data: { months, reason, previousEndDate, newEndDate },
      },
    });
    // "O Kore estendeu o site sem custo. Ele fica no ar até 14 de mai. de 2027."
    const owners = await tx.membership.findMany({
      where: { weddingId, role: 'owner', removedAt: null },
      select: { userId: true },
    });
    if (owners.length > 0)
      await tx.notification.createMany({
        data: owners.map(({ userId }) => ({
          id: uuidV7({ now: now.getTime() }),
          userId,
          weddingId,
          type: 'billing' as const,
          groupKey: `billing:courtesy:${newEndDate}`,
          payload: [
            { kind: 'courtesy', endDate: newEndDate, at: now.toISOString() },
          ] as Prisma.InputJsonValue,
          createdAt: now,
          updatedAt: now,
        })),
        skipDuplicates: true,
      });
    const pending = await tx.payment.findMany({
      where: { weddingId, kind: 'extension', status: 'pending' },
      select: { id: true },
    });
    return { pendingExtensionIds: pending.map(({ id }) => id) };
  }

  async hasOpenAlert({
    paymentId,
    type,
  }: {
    paymentId: string;
    type: 'gateway_amount_mismatch' | 'refund_failed';
  }): Promise<boolean> {
    const open = await this.db().alert.count({
      where: { entityType: 'payment', entityId: paymentId, type, status: 'open' },
    });
    return open > 0;
  }

  async markAppliedByAdmin({ paymentId, now }: { paymentId: string; now: Date }): Promise<void> {
    await this.db().payment.update({
      where: { id: paymentId },
      data: { appliedByAdminAt: now },
    });
  }

  async markRefundedOutside({
    paymentId,
    receiptKey,
  }: {
    paymentId: string;
    receiptKey: string;
  }): Promise<void> {
    await this.db().payment.update({
      where: { id: paymentId },
      data: { refundOrigin: 'manual', refundedOutsideGateway: true, refundReceiptKey: receiptKey },
    });
  }

  async log({
    action,
    weddingId,
    paymentId,
    adminUserId,
    data,
    now,
  }: {
    action: string;
    weddingId: string;
    paymentId: string;
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
        weddingId,
        entityType: 'payment',
        entityId: paymentId,
        data: data as Prisma.InputJsonValue,
      },
    });
  }

  async resolveAlerts({
    paymentId,
    types,
    adminUserId,
    now,
  }: {
    paymentId: string;
    types: ('gateway_amount_mismatch' | 'refund_failed')[];
    adminUserId: string;
    now: Date;
  }): Promise<void> {
    await this.db().alert.updateMany({
      where: { entityType: 'payment', entityId: paymentId, type: { in: types }, status: 'open' },
      data: { status: 'resolved', resolvedAt: now, resolvedByUserId: adminUserId },
    });
  }
}
