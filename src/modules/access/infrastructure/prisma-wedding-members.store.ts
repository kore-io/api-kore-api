import { Injectable } from '@nestjs/common';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type { PlannerLeftNotice } from '../application/ports/collaboration-notice-mailer.port';
import { firstName } from '../domain/access-invitation';
import { creditNameForSite } from '../domain/planner-profile';
import type {
  PendingAccessInvitation,
  WeddingMember,
  WeddingMembersStore,
} from '../application/ports/wedding-members-store.port';

@Injectable()
export class PrismaWeddingMembersStore implements WeddingMembersStore {
  constructor(private readonly tenant: TenantTransaction) {}

  async listActive({ weddingId }: { weddingId: string }): Promise<WeddingMember[]> {
    const memberships = await this.tenant.client().membership.findMany({
      where: { weddingId, removedAt: null },
      // Donos primeiro (ordem do enum), depois por chegada.
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        userId: true,
        role: true,
        user: { select: { name: true, referrer: { select: { kind: true } } } },
      },
    });
    return memberships.map(({ id, userId, role, user }) => ({
      id,
      userId,
      name: user.name,
      role,
      ...(role === 'collaborator' && user.referrer ? { kind: user.referrer.kind } : {}),
    }));
  }

  listPendingInvitations({ weddingId }: { weddingId: string }): Promise<PendingAccessInvitation[]> {
    return this.tenant.client().accessInvitation.findMany({
      where: { weddingId, acceptedAt: null, declinedAt: null, revokedAt: null, supersededAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, kind: true, expiresAt: true },
    });
  }

  async lockWedding({ weddingId }: { weddingId: string }): Promise<void> {
    await this.tenant.client()
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wedding:${weddingId}`}, 0))`;
  }

  async remove({
    membershipId,
    removedByUserId,
    now,
  }: {
    membershipId: string;
    removedByUserId: string;
    now: Date;
  }): Promise<void> {
    await this.tenant.client().membership.updateMany({
      where: { id: membershipId, removedAt: null },
      data: { removedAt: now, removedByUserId },
    });
  }

  async releasePartnerLogin({ weddingId }: { weddingId: string }): Promise<void> {
    await this.tenant.client().$executeRaw`SELECT release_partner_login(${weddingId}::uuid)`;
  }

  async notifyRemoved({
    membershipId,
    notificationId,
  }: {
    membershipId: string;
    notificationId: string;
  }): Promise<void> {
    await this.tenant.client().$queryRaw`
      SELECT notify_membership_removed(${membershipId}::uuid, ${notificationId}::uuid)`;
  }

  async plannerLeftNotices({
    weddingId,
    userId,
  }: {
    weddingId: string;
    userId: string;
  }): Promise<PlannerLeftNotice[]> {
    const tx = this.tenant.client();
    const planner = await tx.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        referrer: {
          select: { kind: true, status: true, planner: { select: { creditName: true } } },
        },
      },
    });
    const referrer = planner?.referrer;
    if (referrer?.kind !== 'planner' || referrer.status !== 'active' || !referrer.planner)
      return [];
    const partners = await tx.partner.findMany({
      where: { weddingId },
      orderBy: { slot: 'asc' },
      select: { displayName: true, userId: true },
    });
    const owners = await tx.membership.findMany({
      where: { weddingId, role: 'owner', removedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { userId: true, user: { select: { email: true, name: true } } },
    });
    const partnerNames: [string, string] = [
      firstName({ name: partners[0]?.displayName ?? '' }),
      firstName({ name: partners[1]?.displayName ?? '' }),
    ];
    const plannerName = (planner?.name ?? '').trim();
    // O nome da assessoria como o site e o convite mostram (Assinatura RN03); o
    // que não passa no predicado cai no nome dela.
    const agencyName = creditNameForSite({ raw: referrer.planner.creditName }) ?? plannerName;
    return owners.map((owner) => ({
      to: owner.user.email,
      ownerName: firstName({
        name:
          partners.find((partner) => partner.userId === owner.userId)?.displayName ??
          owner.user.name ??
          '',
      }),
      plannerName,
      agencyName,
      partnerNames,
    }));
  }
}
