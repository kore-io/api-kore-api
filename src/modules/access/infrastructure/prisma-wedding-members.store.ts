import { Injectable } from '@nestjs/common';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
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
}
