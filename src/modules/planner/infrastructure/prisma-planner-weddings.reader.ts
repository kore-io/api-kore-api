import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type {
  CollaborationDetail,
  PlannerWeddingsReader,
} from '../application/ports/planner-weddings-reader.port';
import type { CollaborationRow, DeliveryCounts, MyWeddingStatus } from '../domain/my-weddings';

const WEDDING_SELECT = {
  id: true,
  slug: true,
  status: true,
  eventDate: true,
  city: true,
  state: true,
  timezone: true,
  createdAt: true,
  createdByUserId: true,
  referralSource: true,
  rsvpDeadline: true,
  referrer: { select: { userId: true } },
  partners: { select: { slot: true, displayName: true }, orderBy: { slot: 'asc' } },
  stats: {
    select: {
      guestsTotal: true,
      confirmed: true,
      declined: true,
      pending: true,
      rsvpPercent: true,
    },
  },
} as const satisfies Prisma.WeddingSelect;

type WeddingRow = Prisma.WeddingGetPayload<{ select: typeof WEDDING_SELECT }>;

const day = (value: Date | null): string | null => value?.toISOString().slice(0, 10) ?? null;
const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? '';

function toRow(wedding: WeddingRow): CollaborationRow {
  const name = (slot: number) =>
    firstName(wedding.partners.find((partner) => partner.slot === slot)?.displayName ?? '');
  return {
    weddingId: wedding.id,
    partnerNames: [name(1), name(2)],
    eventDate: day(wedding.eventDate),
    city: wedding.city ?? '',
    state: wedding.state ?? '',
    timezone: wedding.timezone ?? 'America/Sao_Paulo',
    status: wedding.status as MyWeddingStatus,
    createdAt: wedding.createdAt,
    createdByUserId: wedding.createdByUserId,
    referralSource: wedding.referralSource,
    referrerUserId: wedding.referrer?.userId ?? null,
    rsvpDeadline: day(wedding.rsvpDeadline),
    stats: {
      guestsTotal: wedding.stats?.guestsTotal ?? 0,
      confirmed: wedding.stats?.confirmed ?? 0,
      declined: wedding.stats?.declined ?? 0,
      pending: wedding.stats?.pending ?? 0,
      rsvpPercent: Number(wedding.stats?.rsvpPercent ?? 0),
    },
  };
}

/** Na transação da requisição, com a RLS por vínculo (sem `app.wedding_id`). */
@Injectable()
export class PrismaPlannerWeddingsReader implements PlannerWeddingsReader {
  constructor(private readonly tenant: TenantTransaction) {}

  async listCollaborations({ userId }: { userId: string }): Promise<CollaborationRow[]> {
    // RN01: só o vínculo collaborator ativo; a RLS traria também o casamento
    // de que ela é dona, que fica na Área do Casal.
    const memberships = await this.tenant.client().membership.findMany({
      where: {
        userId,
        role: 'collaborator',
        removedAt: null,
        wedding: { status: { not: 'purged' } },
      },
      select: { wedding: { select: WEDDING_SELECT } },
    });
    return memberships.map(({ wedding }) => toRow(wedding));
  }

  async deliveryCounts({
    weddingIds,
  }: {
    weddingIds: string[];
  }): Promise<Map<string, DeliveryCounts>> {
    if (weddingIds.length === 0) return new Map();
    // Contado na leitura, só nos candidatos, pelo índice parcial dos grupos
    // ativos (RN06; decisão 224(4)): sem contador no WeddingStats.
    const rows = await this.tenant.client().$queryRaw<
      { wedding_id: string; total: number; not_sent: number }[]
    >`
      SELECT wedding_id, count(*)::int AS total,
             count(*) FILTER (WHERE delivery_status = 'not_sent')::int AS not_sent
      FROM parties
      WHERE wedding_id IN (${Prisma.join(weddingIds.map((id) => Prisma.sql`${id}::uuid`))})
        AND deleted_at IS NULL
      GROUP BY wedding_id`;
    return new Map(
      rows.map((row) => [
        row.wedding_id,
        { partiesTotal: row.total, partiesNotSent: row.not_sent },
      ]),
    );
  }

  async collaboration({
    userId,
    weddingId,
  }: {
    userId: string;
    weddingId: string;
  }): Promise<CollaborationDetail | null> {
    const tx = this.tenant.client();
    const membership = await tx.membership.findFirst({
      where: {
        userId,
        weddingId,
        role: 'collaborator',
        removedAt: null,
        wedding: { status: { not: 'purged' } },
      },
      select: { wedding: { select: WEDDING_SELECT } },
    });
    if (!membership) return null;
    const owners = await tx.membership.count({
      where: { weddingId, role: 'owner', removedAt: null },
    });
    const invitations = await tx.accessInvitation.findMany({
      where: {
        weddingId,
        kind: 'couple',
        acceptedAt: null,
        declinedAt: null,
        revokedAt: null,
        supersededAt: null,
      },
      select: {
        id: true,
        email: true,
        invitedByUserId: true,
        createdAt: true,
        expiresAt: true,
        tokenEncrypted: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    return {
      ...toRow(membership.wedding),
      slug: membership.wedding.slug,
      hasOwner: owners > 0,
      pendingCoupleInvitations: invitations,
    };
  }
}
