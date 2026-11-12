import { Injectable } from '@nestjs/common';
import { liveWeddingField } from './live-wedding-field';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type {
  AccessInvitationStore,
  InvitationWeddingDetails,
  Inviter,
  NewAccessInvitation,
  PendingInvitation,
  StoredInvitation,
} from '../application/ports/access-invitation-store.port';

const PENDING = { acceptedAt: null, declinedAt: null, revokedAt: null, supersededAt: null };

/** Na transação da requisição: a RLS mostra só os convites dos casamentos da pessoa. */
@Injectable()
export class PrismaAccessInvitationStore implements AccessInvitationStore {
  constructor(private readonly tenant: TenantTransaction) {}

  async lockWedding({ weddingId }: { weddingId: string }): Promise<void> {
    await this.tenant.client()
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wedding:${weddingId}`}, 0))`;
  }

  async loadWedding({ weddingId }: { weddingId: string }): Promise<InvitationWeddingDetails> {
    const tx = this.tenant.client();
    const wedding = await tx.wedding.findUniqueOrThrow({
      where: { id: weddingId },
      select: {
        status: true,
        createdByUserId: true,
        referralSource: true,
        eventDate: true,
        city: true,
        state: true,
        partners: { select: { slot: true, displayName: true }, orderBy: { slot: 'asc' } },
      },
    });
    const memberships = await tx.membership.groupBy({
      by: ['role'],
      where: { weddingId, removedAt: null },
      _count: { _all: true },
    });
    const count = (role: 'owner' | 'collaborator') =>
      memberships.find((group) => group.role === role)?._count._all ?? 0;
    const name = (slot: number) =>
      wedding.partners.find((partner) => partner.slot === slot)?.displayName ?? '';
    return {
      status: wedding.status,
      createdByUserId: liveWeddingField({
        value: wedding.createdByUserId,
        field: 'createdByUserId',
      }),
      createdByReferrer:
        wedding.referralSource === 'created_by_planner' ||
        wedding.referralSource === 'created_by_seller',
      activeOwners: count('owner'),
      activeCollaborators: count('collaborator'),
      partnerNames: [name(1), name(2)],
      eventDate: wedding.eventDate,
      city: liveWeddingField({ value: wedding.city, field: 'city' }),
      state: liveWeddingField({ value: wedding.state, field: 'state' }),
    };
  }

  async loadInviter({
    weddingId,
    userId,
  }: {
    weddingId: string;
    userId: string;
  }): Promise<Inviter> {
    const tx = this.tenant.client();
    const [partner, user] = await Promise.all([
      tx.partner.findFirst({ where: { weddingId, userId }, select: { displayName: true } }),
      tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          name: true,
          referrer: { select: { kind: true, planner: { select: { creditName: true } } } },
        },
      }),
    ]);
    return {
      partnerName: partner?.displayName ?? null,
      userName: user.name,
      referrerKind: user.referrer?.kind ?? null,
      creditName: user.referrer?.planner?.creditName ?? null,
    };
  }

  listPending({ weddingId }: { weddingId: string }): Promise<PendingInvitation[]> {
    return this.tenant.client().accessInvitation.findMany({
      where: { weddingId, ...PENDING },
      select: { id: true, kind: true, email: true, expiresAt: true },
    });
  }

  async supersede({ invitationIds, now }: { invitationIds: string[]; now: Date }): Promise<void> {
    if (!invitationIds.length) return;
    await this.tenant.client().accessInvitation.updateMany({
      where: { id: { in: invitationIds }, ...PENDING },
      data: { supersededAt: now },
    });
  }

  async insert({ invitations }: { invitations: NewAccessInvitation[] }): Promise<void> {
    await this.tenant.client().accessInvitation.createMany({ data: invitations });
  }

  async markAwaitingCouple({ weddingId }: { weddingId: string }): Promise<void> {
    await this.tenant.client().wedding.updateMany({
      where: { id: weddingId, status: 'draft' },
      data: { status: 'awaiting_couple' },
    });
  }

  async touchActivity({ weddingId, now }: { weddingId: string; now: Date }): Promise<void> {
    await this.tenant.client().wedding.updateMany({
      where: { id: weddingId },
      // Atividade nova zera o aviso de exclusão (decisão 180).
      data: { lastActivityAt: now, purgeNoticeSentAt: null },
    });
  }

  find({
    weddingId,
    invitationId,
  }: {
    weddingId: string;
    invitationId: string;
  }): Promise<StoredInvitation | null> {
    return this.tenant.client().accessInvitation.findFirst({
      where: { id: invitationId, weddingId },
      select: {
        id: true,
        invitedByUserId: true,
        expiresAt: true,
        acceptedAt: true,
        declinedAt: true,
        revokedAt: true,
        supersededAt: true,
      },
    });
  }

  async revoke({ invitationId, now }: { invitationId: string; now: Date }): Promise<void> {
    await this.tenant.client().accessInvitation.updateMany({
      where: { id: invitationId, ...PENDING },
      data: { revokedAt: now },
    });
  }
}
