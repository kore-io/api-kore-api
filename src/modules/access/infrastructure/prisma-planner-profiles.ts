import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma.service';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import { uuidV7 } from '../../../shared/ids/uuid-v7';
import type { PlannerProfiles } from '../application/ports/planner-profiles.port';
import { nextReferralCode, referralCodeBase } from '../domain/invitation-acceptance';

/**
 * Conflitos seguidos no código antes de desistir. Cada um é outro aceite que
 * pegou o mesmo número no mesmo instante; não há teto para o número em si.
 */
const MAX_CODE_CONFLICTS = 100;

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
    const base = referralCodeBase({ name });
    // O próximo sufixo livre, sem teto (decisão 211). Se outro aceite pegar o
    // mesmo código entre a leitura e o INSERT, lê de novo e tenta o seguinte.
    for (let conflicts = 0; ; conflicts++) {
      if (conflicts >= MAX_CODE_CONFLICTS)
        throw new Error('Conflitos seguidos no código de indicação.');
      const taken = await db.referrer.findMany({
        where: { OR: [{ referralCode: base }, { referralCode: { startsWith: `${base}-` } }] },
        select: { referralCode: true },
      });
      const referralCode = nextReferralCode({
        base,
        taken: taken.map((referrer) => referrer.referralCode),
      });
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
      // O skipDuplicates também pula o conflito do userId (único): quem já tem
      // perfil de indicador não ganha outro, e o laço não pode girar à toa.
      if (await db.referrer.findUnique({ where: { userId }, select: { id: true } }))
        throw new Error('A pessoa já tem perfil de indicador.');
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
