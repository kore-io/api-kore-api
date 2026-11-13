import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database/prisma.service';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type {
  AccountOverview,
  MembershipSummary,
  ProfileDirectory,
} from '../application/ports/profile-directory.port';
import type { ProfileKind } from '../domain/authenticated-session';
import { coupleNames, type InvitationPartner } from '../domain/invitation-acceptance';
import { profilesOf } from '../domain/profiles';
import { liveWeddingField } from './live-wedding-field';

/**
 * Perfis e vínculos da pessoa, lidos com a RLS como ela (a própria pessoa vê os
 * próprios vínculos). Na requisição autenticada, pela transação dela; no login
 * (rota pública), numa transação curta com o app.user_id da conta que acabou
 * de entrar.
 */
const day = (value: Date | null): string | null => value?.toISOString().slice(0, 10) ?? null;

@Injectable()
export class PrismaProfileDirectory implements ProfileDirectory {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantTransaction,
  ) {}

  async listProfiles({ userId }: { userId: string }): Promise<ProfileKind[]> {
    return (await this.overview({ userId })).profiles;
  }

  overview({ userId }: { userId: string }): Promise<AccountOverview> {
    const current = this.tenant.optionalClient();
    if (current) return this.read({ tx: current, userId });
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.user_id', ${userId}, true)`;
      return this.read({ tx, userId });
    });
  }

  private async read({
    tx,
    userId,
  }: {
    tx: Prisma.TransactionClient;
    userId: string;
  }): Promise<AccountOverview> {
    const [memberships, referrer] = await Promise.all([
      tx.membership.findMany({
        where: { userId, removedAt: null, wedding: { status: { not: 'purged' } } },
        orderBy: { createdAt: 'asc' },
        select: {
          role: true,
          wedding: {
            select: {
              id: true,
              eventDate: true,
              city: true,
              state: true,
              status: true,
              endDate: true,
              graceUntil: true,
              expiredAt: true,
              deletionScheduledFor: true,
              blockedAt: true,
              partners: { select: { slot: true, displayName: true, title: true, userId: true } },
            },
          },
        },
      }),
      tx.referrer.findUnique({
        where: { userId },
        select: {
          kind: true,
          status: true,
          referralCode: true,
          planner: { select: { creditName: true } },
        },
      }),
    ]);
    const summaries: MembershipSummary[] = memberships.map(({ role, wedding }) => ({
      weddingId: wedding.id,
      role,
      weddingName: coupleNames({ partners: wedding.partners as InvitationPartner[] }),
      eventDate: wedding.eventDate,
      city: liveWeddingField({ value: wedding.city, field: 'city' }),
      state: liveWeddingField({ value: wedding.state, field: 'state' }),
      lifecycle: {
        status: wedding.status,
        blocked: wedding.blockedAt !== null,
        endDate: day(wedding.endDate),
        graceUntil: day(wedding.graceUntil),
        expiredAt: day(wedding.expiredAt),
        deletionScheduledFor: day(wedding.deletionScheduledFor),
      },
    }));
    const profiles = profilesOf({
      ownsActiveWedding: summaries.some((membership) => membership.role === 'owner'),
      referrer,
    });
    return {
      memberships: summaries,
      profiles,
      planner:
        profiles.includes('planner') && referrer?.planner
          ? {
              organization: referrer.planner.creditName,
              weddingsCount: summaries.filter((membership) => membership.role === 'collaborator')
                .length,
            }
          : null,
      referrer: referrer ? { kind: referrer.kind, referralCode: referrer.referralCode } : null,
    };
  }
}
