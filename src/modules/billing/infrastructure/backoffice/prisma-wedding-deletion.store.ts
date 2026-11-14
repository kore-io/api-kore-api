import { Injectable } from '@nestjs/common';
import { BackofficeTransaction } from '../../../../shared/database/backoffice-transaction';
import { coupleNames, type InvitationPartner } from '../../../access/domain/invitation-acceptance';
import type {
  DeletionMoneyLocks,
  DeletionTarget,
  WeddingDeletionStore,
  WeddingLifecycleView,
} from '../../application/ports/wedding-deletion.store.port';

const day = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);
const firstName = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] ?? '';

/** Na transação corrente da BackofficeTransaction (kore_backoffice). */
@Injectable()
export class PrismaWeddingDeletionStore implements WeddingDeletionStore {
  constructor(private readonly transaction: BackofficeTransaction) {}

  private db() {
    return this.transaction.client();
  }

  async lockWedding({ weddingId }: { weddingId: string }): Promise<DeletionTarget | null> {
    const [row] = await this.db().$queryRaw<
      {
        status: string;
        timezone: string | null;
        blocked: boolean;
        deletionScheduledFor: Date | null;
      }[]
    >`
      SELECT status::text AS status, timezone, blocked_at IS NOT NULL AS blocked,
             deletion_scheduled_for AS "deletionScheduledFor"
      FROM weddings WHERE id = ${weddingId}::uuid AND status <> 'purged' FOR UPDATE`;
    if (!row) return null;
    const partners = await this.db().partner.findMany({
      where: { weddingId },
      select: { slot: true, displayName: true, title: true, userId: true },
    });
    return {
      status: row.status,
      timezone: row.timezone,
      blocked: row.blocked,
      deletionScheduledFor: day(row.deletionScheduledFor),
      weddingName: coupleNames({ partners: partners as InvitationPartner[] }),
    };
  }

  async moneyLocks({
    weddingId,
    now,
  }: {
    weddingId: string;
    now: Date;
  }): Promise<DeletionMoneyLocks> {
    // Depois do Wedding, os Payments (a ordem única de Publicar e pagar RN18).
    await this.db().$queryRaw`
      SELECT id FROM payments WHERE wedding_id = ${weddingId}::uuid ORDER BY id FOR UPDATE`;
    // O prazo de desistir, no fuso do casamento: o mesmo cálculo e o mesmo
    // recorte da request_payment_refund (até o fim do 7º dia depois do
    // pagamento; a publicação, ou só a última extensão, contando as cortesias),
    // para a tela não mandar desistir do que o Desistir recusa.
    const [window] = await this.db().$queryRaw<{ until: Date | null }[]>`
      SELECT max((((p.paid_at AT TIME ZONE COALESCE(w.timezone, 'America/Sao_Paulo'))::date + 8)
                  ::timestamp AT TIME ZONE COALESCE(w.timezone, 'America/Sao_Paulo'))
                 - interval '1 millisecond') AS until
      FROM payments p JOIN weddings w ON w.id = p.wedding_id
      WHERE p.wedding_id = ${weddingId}::uuid AND p.status = 'paid'
        AND p.applied_at IS NOT NULL AND p.paid_at IS NOT NULL
        AND (p.kind = 'publication' OR (
          NOT EXISTS (
            SELECT 1 FROM payments e
            WHERE e.wedding_id = p.wedding_id AND e.kind = 'extension' AND e.id <> p.id
              AND e.applied_at IS NOT NULL AND e.status IN ('paid', 'disputed')
              AND e.period_start > p.period_start)
          AND NOT EXISTS (
            SELECT 1 FROM courtesy_extensions c
            WHERE c.wedding_id = p.wedding_id AND c.period_start >= p.period_end)))`;
    const payments = await this.db().payment.findMany({
      where: { weddingId, status: { in: ['pending', 'refund_requested', 'disputed'] } },
      select: { id: true, status: true },
    });
    const until = window?.until ?? null;
    return {
      refundableUntil: until && until > now ? until : null,
      refundInProgress: payments.some((payment) => payment.status === 'refund_requested'),
      disputed: payments.some((payment) => payment.status === 'disputed'),
      pendingPaymentIds: payments
        .filter((payment) => payment.status === 'pending')
        .map((payment) => payment.id),
    };
  }

  async schedule({
    weddingId,
    userId,
    deletionScheduledFor,
    now,
  }: {
    weddingId: string;
    userId: string;
    deletionScheduledFor: string;
    now: Date;
  }): Promise<void> {
    await this.db().wedding.update({
      where: { id: weddingId },
      data: {
        deletionScheduledFor: new Date(`${deletionScheduledFor}T00:00:00Z`),
        deletionRequestedByUserId: userId,
      },
    });
    await this.log({
      action: 'wedding.deletion_requested',
      weddingId,
      userId,
      data: { deletionScheduledFor },
      now,
    });
  }

  async cancel({
    weddingId,
    userId,
    now,
  }: {
    weddingId: string;
    userId: string;
    now: Date;
  }): Promise<void> {
    await this.db().wedding.update({
      where: { id: weddingId },
      data: { deletionScheduledFor: null, deletionRequestedByUserId: null },
    });
    await this.log({ action: 'wedding.deletion_canceled', weddingId, userId, data: null, now });
  }

  async owners({
    weddingId,
  }: {
    weddingId: string;
  }): Promise<{ userId: string; email: string; firstName: string }[]> {
    const owners = await this.db().membership.findMany({
      where: { weddingId, role: 'owner', removedAt: null, user: { status: 'active' } },
      orderBy: { createdAt: 'asc' },
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
    });
    return owners.map(({ userId, user }) => ({
      userId,
      email: user.email,
      firstName: firstName(user.partners[0]?.displayName ?? user.name),
    }));
  }

  async lifecycle({ weddingId }: { weddingId: string }): Promise<WeddingLifecycleView> {
    const wedding = await this.db().wedding.findUniqueOrThrow({
      where: { id: weddingId },
      select: {
        status: true,
        blockedAt: true,
        endDate: true,
        graceUntil: true,
        expiredAt: true,
        deletionScheduledFor: true,
      },
    });
    return {
      status: wedding.status,
      blocked: wedding.blockedAt !== null,
      endDate: day(wedding.endDate),
      graceUntil: day(wedding.graceUntil),
      expiredAt: day(wedding.expiredAt),
      deletionScheduledFor: day(wedding.deletionScheduledFor),
    };
  }

  private async log({
    action,
    weddingId,
    userId,
    data,
    now,
  }: {
    action: string;
    weddingId: string;
    userId: string;
    data: Record<string, string> | null;
    now: Date;
  }): Promise<void> {
    await this.db().applicationLog.createMany({
      data: [
        {
          createdAt: now,
          action,
          actorKind: 'user',
          actorUserId: userId,
          weddingId,
          entityType: 'wedding',
          entityId: weddingId,
          ...(data ? { data } : {}),
        },
      ],
    });
  }
}
