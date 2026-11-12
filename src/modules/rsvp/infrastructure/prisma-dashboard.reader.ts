import { Injectable } from '@nestjs/common';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type { DeliveryCounts, ReminderQueue } from '../domain/dashboard';
import type {
  ActivityGroup,
  ActivityRow,
  DashboardReader,
  DashboardStats,
  DashboardWedding,
} from '../application/ports/dashboard-reader.port';

const RECENT = 5;
const day = (date: Date | null): string | null => (date ? date.toISOString().slice(0, 10) : null);

/** Na transação da requisição, com a RLS ligada; sem cache (Dashboard RN08). */
@Injectable()
export class PrismaDashboardReader implements DashboardReader {
  constructor(private readonly tenant: TenantTransaction) {}

  async wedding({ weddingId }: { weddingId: string }): Promise<DashboardWedding | null> {
    const wedding = await this.tenant.client().wedding.findFirst({
      where: { id: weddingId },
      select: {
        status: true,
        slug: true,
        timezone: true,
        eventDate: true,
        rsvpDeadline: true,
        endDate: true,
        publishedAt: true,
        appearanceSetAt: true,
      },
    });
    if (!wedding) return null;
    return {
      ...wedding,
      eventDate: day(wedding.eventDate),
      rsvpDeadline: day(wedding.rsvpDeadline),
      endDate: day(wedding.endDate),
    };
  }

  async stats({ weddingId }: { weddingId: string }): Promise<DashboardStats> {
    const stats = await this.tenant.client().weddingStats.findFirst({ where: { weddingId } });
    return {
      guestsTotal: stats?.guestsTotal ?? 0,
      confirmed: stats?.confirmed ?? 0,
      declined: stats?.declined ?? 0,
      pending: stats?.pending ?? 0,
      adultsConfirmed: stats?.adultsConfirmed ?? 0,
      childrenConfirmed: stats?.childrenConfirmed ?? 0,
      babiesConfirmed: stats?.babiesConfirmed ?? 0,
      partiesPending: stats?.partiesPending ?? 0,
      rsvpPercent: stats ? Number(stats.rsvpPercent) : 0,
    };
  }

  async delivery({ weddingId }: { weddingId: string }): Promise<DeliveryCounts> {
    const rows = await this.tenant.client().party.groupBy({
      by: ['deliveryStatus'],
      where: { weddingId, deletedAt: null },
      _count: { _all: true },
    });
    const count = (status: string) =>
      rows.find((row) => row.deliveryStatus === status)?._count._all ?? 0;
    return {
      notSent: count('not_sent'),
      sent: count('sent'),
      viewed: count('viewed'),
      responded: count('responded'),
    };
  }

  async reminderQueue({ weddingId }: { weddingId: string }): Promise<ReminderQueue> {
    const [row] = await this.tenant.client().$queryRaw<[ReminderQueue]>`
      WITH queue AS (
        SELECT p.id, p.sent_at, p.last_reminder_at,
               (SELECT count(*) FROM guests g WHERE g.party_id = p.id AND g.deleted_at IS NULL
                  AND g.name IS NOT NULL AND g.rsvp_status = 'pending') AS pending
        FROM parties p
        WHERE p.wedding_id = ${weddingId}::uuid AND p.deleted_at IS NULL
          AND p.delivery_status <> 'not_sent'
      )
      SELECT count(*)::int AS parties, coalesce(sum(pending), 0)::int AS guests,
             (count(*) FILTER (WHERE last_reminder_at IS NULL
                OR (sent_at IS NOT NULL AND last_reminder_at <= sent_at)))::int AS "notReminded"
      FROM queue WHERE pending > 0`;
    return row;
  }

  async notifications({
    userId,
    weddingId,
  }: {
    userId: string;
    weddingId: string;
  }): Promise<ActivityRow[]> {
    const rows = await this.tenant.client().notification.findMany({
      where: { userId, weddingId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: RECENT,
      select: { id: true, count: true, payload: true, readAt: true, updatedAt: true },
    });
    return rows.map((row) => ({
      source: 'notification',
      id: row.id,
      count: row.count,
      groups: row.payload as unknown as ActivityGroup[],
      readAt: row.readAt,
      at: row.updatedAt,
    }));
  }

  async partySubmissions({ weddingId }: { weddingId: string }): Promise<ActivityRow[]> {
    const rows = await this.tenant.client().rsvpSubmission.findMany({
      where: { weddingId, actor: 'party' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: RECENT,
      select: {
        id: true,
        partyId: true,
        confirmedCount: true,
        declinedCount: true,
        createdAt: true,
        party: { select: { name: true } },
      },
    });
    return rows.map((row) => ({
      source: 'submission',
      id: row.id,
      count: 1,
      groups: [
        {
          partyId: row.partyId,
          name: row.party.name,
          confirmed: row.confirmedCount,
          declined: row.declinedCount,
          at: row.createdAt.toISOString(),
        },
      ],
      readAt: null,
      at: row.createdAt,
    }));
  }
}
