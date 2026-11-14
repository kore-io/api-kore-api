import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../../generated/prisma/client';
import { BackofficePrismaService } from '../../../../shared/database/backoffice-prisma.service';
import type { StaffRole } from '../../domain/staff';
import type {
  AdminReferrer,
  AdminWeddingFilter,
  AdminWeddingGeneral,
  AdminWeddingGuest,
  AdminWeddingListQuery,
  AdminWeddingLogEntry,
  AdminWeddingNumbers,
  AdminWeddingRow,
  AdminWeddingsReader,
  AdminWeddingTombstone,
  Page,
  WeddingOrigin,
} from '../../application/ports/admin-weddings.reader.port';

export const ADMIN_PAGE_SIZE = 25;
const LOG_PAGE_SIZE = 50;
const GUESTS_PAGE_SIZE = 100;
const IP_HASH_SHORT = 8;

const day = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);
const firstName = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] ?? '';

const ROW_SELECT = {
  id: true,
  slug: true,
  eventDate: true,
  status: true,
  blockedAt: true,
  endDate: true,
  referralSource: true,
  partners: { select: { slot: true, displayName: true }, orderBy: { slot: 'asc' } },
  stats: { select: { guestsTotal: true, rsvpPercent: true } },
  referrer: {
    select: {
      id: true,
      kind: true,
      user: { select: { name: true } },
      planner: { select: { creditName: true } },
    },
  },
  payments: { where: { status: 'pending' }, select: { id: true }, take: 1 },
} satisfies Prisma.WeddingSelect;

type RowSource = Prisma.WeddingGetPayload<{ select: typeof ROW_SELECT }>;

/** O "where" de cada status do filtro (RN05; decisão 251(3)). */
function statusWhere(filter: AdminWeddingFilter): Prisma.WeddingWhereInput {
  const pendingPix: Prisma.WeddingWhereInput = { payments: { some: { status: 'pending' } } };
  switch (filter) {
    case 'blocked':
      return { blockedAt: { not: null } };
    case 'awaiting_payment':
      return { blockedAt: null, status: 'draft', ...pendingPix };
    case 'draft':
      return { blockedAt: null, status: 'draft', NOT: pendingPix };
    default:
      return { blockedAt: null, status: filter };
  }
}

function referrerOf(source: RowSource['referrer']): AdminReferrer | null {
  if (!source) return null;
  return {
    id: source.id,
    kind: source.kind,
    name: source.planner?.creditName ?? source.user.name ?? '',
  };
}

function rsvpPercentOf(stats: RowSource['stats']): number | null {
  if (!stats || stats.guestsTotal === 0) return null;
  return Number(stats.rsvpPercent);
}

function toRow(wedding: RowSource): AdminWeddingRow {
  const referrer = referrerOf(wedding.referrer);
  const origin: WeddingOrigin = referrer?.kind ?? 'couple';
  const displayStatus: AdminWeddingFilter = wedding.blockedAt
    ? 'blocked'
    : wedding.status === 'draft' && wedding.payments.length > 0
      ? 'awaiting_payment'
      : (wedding.status as AdminWeddingFilter);
  return {
    id: wedding.id,
    coupleNames: wedding.partners.map((partner) => firstName(partner.displayName)).join(' & '),
    slug: wedding.slug,
    eventDate: day(wedding.eventDate),
    status: wedding.status,
    displayStatus,
    blocked: wedding.blockedAt !== null,
    origin,
    referralSource: wedding.referralSource,
    referrer,
    rsvpPercent: rsvpPercentOf(wedding.stats),
    endDate: day(wedding.endDate),
  };
}

/** Pela conexão do backoffice (decisão 180(5)): o Backoffice lê fora da RLS por casamento. */
@Injectable()
export class PrismaAdminWeddingsReader implements AdminWeddingsReader {
  constructor(private readonly db: BackofficePrismaService) {}

  async list(query: AdminWeddingListQuery): Promise<Page<AdminWeddingRow>> {
    const and: Prisma.WeddingWhereInput[] = [{ status: { not: 'purged' } }];
    if (query.status) and.push(statusWhere(query.status));
    if (query.eventFrom) and.push({ eventDate: { gte: new Date(`${query.eventFrom}T00:00:00Z`) } });
    if (query.eventTo) and.push({ eventDate: { lte: new Date(`${query.eventTo}T00:00:00Z`) } });
    if (query.referrerId) and.push({ referrerId: query.referrerId });
    // Sem convidados, a taxa é "—" e o casamento só aparece em Todos (decisão 251(1)).
    if (query.rsvp === 'below_50')
      and.push({ stats: { guestsTotal: { gt: 0 }, rsvpPercent: { lt: 50 } } });
    if (query.rsvp === 'from_50')
      and.push({ stats: { guestsTotal: { gt: 0 }, rsvpPercent: { gte: 50 } } });
    const where: Prisma.WeddingWhereInput = { AND: and };
    const [total, weddings] = await Promise.all([
      this.db.wedding.count({ where }),
      this.db.wedding.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * ADMIN_PAGE_SIZE,
        take: ADMIN_PAGE_SIZE,
        select: ROW_SELECT,
      }),
    ]);
    return { items: weddings.map(toRow), page: query.page, pageSize: ADMIN_PAGE_SIZE, total };
  }

  async general({
    weddingId,
    role,
  }: {
    weddingId: string;
    role: StaffRole;
  }): Promise<AdminWeddingGeneral | AdminWeddingTombstone | null> {
    const wedding = await this.db.wedding.findUnique({
      where: { id: weddingId },
      select: {
        ...ROW_SELECT,
        createdAt: true,
        purgedAt: true,
        publishedAt: true,
        graceUntil: true,
        purgeAt: true,
        deletionScheduledFor: true,
        blockedByUserId: true,
        memberships: {
          where: { removedAt: null },
          orderBy: { createdAt: 'asc' },
          select: { role: true, user: { select: { id: true, name: true, email: true } } },
        },
      },
    });
    if (!wedding) return null;
    if (wedding.status === 'purged')
      return {
        id: wedding.id,
        status: 'purged',
        purgedAt: wedding.purgedAt,
        referrer: referrerOf(wedding.referrer),
        referralSource: wedding.referralSource,
        createdAt: wedding.createdAt,
      };
    // O Pix pendente tem valor: só o Admin (RN02; decisão 69).
    const pending =
      role === 'admin'
        ? await this.db.payment.findFirst({
            where: { weddingId, status: 'pending' },
            orderBy: { createdAt: 'desc' },
            select: { id: true, amountCents: true, createdAt: true },
          })
        : null;
    let block: AdminWeddingGeneral['block'] = null;
    if (wedding.blockedAt) {
      const [blockedBy, log] = await Promise.all([
        wedding.blockedByUserId
          ? this.db.user.findUnique({
              where: { id: wedding.blockedByUserId },
              select: { id: true, name: true },
            })
          : null,
        this.db.applicationLog.findFirst({
          where: { weddingId, action: 'wedding.blocked' },
          orderBy: { createdAt: 'desc' },
          select: { data: true },
        }),
      ]);
      const reason = (log?.data as { reason?: unknown } | null)?.reason;
      block = {
        blockedAt: wedding.blockedAt,
        blockedBy: blockedBy ? { userId: blockedBy.id, name: blockedBy.name } : null,
        reason: typeof reason === 'string' ? reason : null,
      };
    }
    return {
      ...toRow(wedding),
      createdAt: wedding.createdAt,
      people: wedding.memberships.map(({ role: membershipRole, user }) => ({
        userId: user.id,
        name: user.name,
        email: user.email,
        role: membershipRole,
      })),
      publishedAt: wedding.publishedAt,
      graceUntil: day(wedding.graceUntil),
      purgeAt: day(wedding.purgeAt),
      deletionScheduledFor: day(wedding.deletionScheduledFor),
      pendingPayment: pending
        ? { paymentId: pending.id, amountCents: pending.amountCents, createdAt: pending.createdAt }
        : null,
      block,
    };
  }

  async numbers({ weddingId }: { weddingId: string }): Promise<AdminWeddingNumbers | null> {
    const wedding = await this.db.wedding.findUnique({
      where: { id: weddingId },
      select: { stats: true },
    });
    if (!wedding) return null;
    const stats = wedding.stats;
    return {
      guestsTotal: stats?.guestsTotal ?? 0,
      confirmed: stats?.confirmed ?? 0,
      declined: stats?.declined ?? 0,
      pending: stats?.pending ?? 0,
      adultsConfirmed: stats?.adultsConfirmed ?? 0,
      childrenConfirmed: stats?.childrenConfirmed ?? 0,
      babiesConfirmed: stats?.babiesConfirmed ?? 0,
      partiesPending: stats?.partiesPending ?? 0,
      rsvpPercent: stats && stats.guestsTotal > 0 ? Number(stats.rsvpPercent) : null,
    };
  }

  async guests({
    weddingId,
    page,
  }: {
    weddingId: string;
    page: number;
  }): Promise<Page<AdminWeddingGuest> | null> {
    if (!(await this.exists(weddingId))) return null;
    const where: Prisma.GuestWhereInput = { weddingId };
    const [total, guests] = await Promise.all([
      this.db.guest.count({ where }),
      this.db.guest.findMany({
        where,
        orderBy: [{ party: { name: 'asc' } }, { createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * GUESTS_PAGE_SIZE,
        take: GUESTS_PAGE_SIZE,
        // Só grupo e nome (decisão 125(b)): sem contato, resposta nem recado.
        select: {
          id: true,
          name: true,
          deletedAt: true,
          party: { select: { id: true, name: true, deletedAt: true } },
        },
      }),
    ]);
    return {
      items: guests.map((guest) => ({
        guestId: guest.id,
        partyId: guest.party.id,
        partyName: guest.party.name,
        name: guest.name,
        inTrash: guest.deletedAt !== null || guest.party.deletedAt !== null,
      })),
      page,
      pageSize: GUESTS_PAGE_SIZE,
      total,
    };
  }

  async log({
    weddingId,
    page,
  }: {
    weddingId: string;
    page: number;
  }): Promise<Page<AdminWeddingLogEntry> | null> {
    if (!(await this.exists(weddingId))) return null;
    const where: Prisma.ApplicationLogWhereInput = { weddingId };
    const [total, rows] = await Promise.all([
      this.db.applicationLog.count({ where }),
      this.db.applicationLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * LOG_PAGE_SIZE,
        take: LOG_PAGE_SIZE,
      }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        action: row.action,
        actorKind: row.actorKind,
        actorUserId: row.actorUserId,
        entityType: row.entityType,
        entityId: row.entityId,
        data: row.data,
        ipHashShort: row.ipHash ? row.ipHash.slice(0, IP_HASH_SHORT) : null,
      })),
      page,
      pageSize: LOG_PAGE_SIZE,
      total,
    };
  }

  private async exists(weddingId: string): Promise<boolean> {
    return (await this.db.wedding.count({ where: { id: weddingId } })) > 0;
  }
}
