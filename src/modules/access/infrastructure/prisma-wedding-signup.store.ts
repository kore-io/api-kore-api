import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type {
  NewWedding,
  WeddingSignupStore,
} from '../application/ports/wedding-signup-store.port';

/**
 * Na transação da requisição, com a RLS ligada: as policies de inclusão do
 * cadastro (migration wedding_signup) deixam a pessoa criar só o próprio
 * casamento, o próprio vínculo de dono e os noivos dele. Sem RETURNING nas
 * inclusões: a pessoa só lê o casamento depois de ter o vínculo.
 */
@Injectable()
export class PrismaWeddingSignupStore implements WeddingSignupStore {
  constructor(private readonly tenant: TenantTransaction) {}

  async lockOwner({ userId }: { userId: string }): Promise<void> {
    await this.tenant.client()
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wedding-owner:${userId}`}, 0))`;
  }

  async findActiveOwnedWeddingId({ userId }: { userId: string }): Promise<string | null> {
    const membership = await this.tenant.client().membership.findFirst({
      where: { userId, role: 'owner', removedAt: null, wedding: { status: { not: 'purged' } } },
      select: { weddingId: true },
      orderBy: { createdAt: 'asc' },
    });
    return membership?.weddingId ?? null;
  }

  async create({ wedding }: { wedding: NewWedding }): Promise<'created' | 'slug_taken'> {
    const tx = this.tenant.client();
    try {
      await tx.wedding.createMany({
        data: {
          id: wedding.weddingId,
          slug: wedding.slug,
          status: 'draft',
          eventDate: wedding.eventDate,
          timezone: wedding.timezone,
          city: wedding.city,
          state: wedding.state,
          createdByUserId: wedding.userId,
          lastActivityAt: wedding.now,
          referrerId: wedding.referrerId,
          referralSource: wedding.referrerId ? 'referral_link' : null,
          signupSource: wedding.signupSource,
          utmSource: wedding.utmSource,
          utmMedium: wedding.utmMedium,
          utmCampaign: wedding.utmCampaign,
        },
      });
    } catch (error) {
      if (isSlugConflict(error)) return 'slug_taken';
      throw error;
    }
    await tx.membership.createMany({
      data: { weddingId: wedding.weddingId, userId: wedding.userId, role: 'owner' },
    });
    await tx.partner.createMany({
      data: [
        {
          weddingId: wedding.weddingId,
          slot: 1,
          displayName: wedding.myName,
          title: wedding.myTitle,
          userId: wedding.userId,
        },
        {
          weddingId: wedding.weddingId,
          slot: 2,
          displayName: wedding.partnerName,
          // Sem título: o app não sabe o gênero de quem casa com a pessoa (decisão 167).
        },
      ],
    });
    await tx.user.update({
      where: { id: wedding.userId },
      data: {
        name: wedding.myName,
        termsVersion: wedding.termsVersion,
        termsAcceptedAt: wedding.now,
      },
      select: { id: true },
    });
    return 'created';
  }
}

function isSlugConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
    return false;
  return JSON.stringify(error.meta ?? {}).includes('slug');
}
