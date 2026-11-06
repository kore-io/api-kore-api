import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma.service';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import { uuidV7 } from '../../../shared/ids/uuid-v7';
import type { PlannerProfiles } from '../application/ports/planner-profiles.port';
import { referralCodeCandidates } from '../domain/invitation-acceptance';

/** Tentativas de código livre antes de desistir (cada uma é um INSERT). */
const MAX_CODE_ATTEMPTS = 50;

/** Tabelas da indicação: sem RLS de casamento; a API lê e cria (migration referrals). */
@Injectable()
export class PrismaPlannerProfiles implements PlannerProfiles {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantTransaction,
  ) {}

  private db() {
    return this.tenant.optionalClient() ?? this.prisma;
  }

  async referrerKind({ userId }: { userId: string }): Promise<'planner' | 'seller' | null> {
    const referrer = await this.db().referrer.findUnique({
      where: { userId },
      select: { kind: true },
    });
    return referrer?.kind ?? null;
  }

  async createMinimal({
    userId,
    name,
    now,
  }: {
    userId: string;
    name: string;
    now: Date;
  }): Promise<void> {
    const db = this.db();
    const settings = await db.referralSettings.findFirstOrThrow({
      select: { defaultRatePercent: true },
    });
    const referrerId = uuidV7({ now: now.getTime() });
    let attempts = 0;
    for (const referralCode of referralCodeCandidates({ name })) {
      if (attempts++ >= MAX_CODE_ATTEMPTS) throw new Error('Sem código de indicação livre.');
      // ON CONFLICT DO NOTHING: um código já usado não aborta a transação.
      const { count } = await db.referrer.createMany({
        data: {
          id: referrerId,
          userId,
          kind: 'planner',
          referralCode,
          ratePercent: settings.defaultRatePercent,
        },
        skipDuplicates: true,
      });
      if (count === 1) break;
    }
    await db.planner.createMany({ data: { referrerId, creditName: name } });
    const organizationId = uuidV7({ now: now.getTime() });
    await db.organization.createMany({
      data: { id: organizationId, name, createdByUserId: userId },
    });
    await db.organizationMember.createMany({
      data: { organizationId, userId, role: 'owner' },
    });
  }
}
