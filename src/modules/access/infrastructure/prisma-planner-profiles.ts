import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma.service';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import { uuidV7 } from '../../../shared/ids/uuid-v7';
import type {
  NewPlannerProfile,
  PlannerProfileRecord,
  PlannerProfileUpdate,
  PlannerProfiles,
} from '../application/ports/planner-profiles.port';
import { PlannerProfileExistsError } from '../domain/access.errors';
import { nextReferralCode, referralCodeBase } from '../domain/invitation-acceptance';

/**
 * Conflitos seguidos no código antes de desistir. Cada um é outro aceite que
 * pegou o mesmo número no mesmo instante; não há teto para o número em si.
 */
const MAX_CODE_CONFLICTS = 100;

/**
 * Tabelas da indicação: sem RLS de casamento. Desde a F6, a RLS deixa a pessoa
 * criar e alterar só o próprio perfil (migrations f6_model e referrers_rls).
 */
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
    await this.create({
      userId,
      profile: { codeName: name, creditName: name, phone: null, whatsapp: null, cities: [] },
      now,
    });
  }

  async create({
    userId,
    profile,
    now,
  }: {
    userId: string;
    profile: NewPlannerProfile;
    now: Date;
  }): Promise<{ referrerId: string; referralCode: string }> {
    const db = this.db();
    const settings = await db.referralSettings.findFirstOrThrow({
      select: { defaultRatePercent: true },
    });
    const referrerId = uuidV7({ now: now.getTime() });
    const base = referralCodeBase({ name: profile.codeName });
    // O próximo sufixo livre, sem teto (decisão 211). Se outro aceite pegar o
    // mesmo código entre a leitura e o INSERT, lê de novo e tenta o seguinte.
    let referralCode: string;
    for (let conflicts = 0; ; conflicts++) {
      if (conflicts >= MAX_CODE_CONFLICTS)
        throw new Error('Conflitos seguidos no código de indicação.');
      const taken = await db.referrer.findMany({
        where: { OR: [{ referralCode: base }, { referralCode: { startsWith: `${base}-` } }] },
        select: { referralCode: true },
      });
      referralCode = nextReferralCode({
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
      // O skipDuplicates também pula o conflito do userId (único): é a corrida
      // das duas abas (RN03), ou um perfil de indicador que já existe.
      if (await db.referrer.findUnique({ where: { userId }, select: { id: true } }))
        throw new PlannerProfileExistsError();
    }
    await db.planner.createMany({
      data: {
        referrerId,
        creditName: profile.creditName,
        phone: profile.phone,
        whatsapp: profile.whatsapp,
        cities: profile.cities,
      },
    });
    const organizationId = uuidV7({ now: now.getTime() });
    await db.organization.createMany({
      data: { id: organizationId, name: profile.creditName, createdByUserId: userId },
    });
    await db.organizationMember.createMany({
      data: { organizationId, userId, role: 'owner' },
    });
    return { referrerId, referralCode };
  }

  async findOwn({ userId }: { userId: string }): Promise<PlannerProfileRecord | null> {
    const referrer = await this.db().referrer.findFirst({
      where: { userId, kind: 'planner', status: 'active' },
      select: {
        id: true,
        referralCode: true,
        referralDiscountEnabled: true,
        planner: {
          select: {
            creditName: true,
            phone: true,
            whatsapp: true,
            cities: true,
            creditHiddenAt: true,
          },
        },
        user: { select: { email: true, name: true, termsVersion: true } },
      },
    });
    if (!referrer?.planner) return null;
    const { planner } = referrer;
    return {
      referrerId: referrer.id,
      referralCode: referrer.referralCode,
      referralDiscountEnabled: referrer.referralDiscountEnabled,
      creditName: planner.creditName,
      phone: planner.phone,
      whatsapp: planner.whatsapp,
      cities: planner.cities,
      creditHidden: planner.creditHiddenAt !== null,
      user: referrer.user,
    };
  }

  async update({
    userId,
    referrerId,
    changes,
  }: {
    userId: string;
    referrerId: string;
    changes: PlannerProfileUpdate;
  }): Promise<void> {
    const db = this.db();
    if (Object.keys(changes).length > 0)
      await db.planner.update({ where: { referrerId }, data: changes });
    if (changes.creditName === undefined) return;
    // A assessoria tem o nome da assinatura (decisão 113): a de que ela é dona.
    await db.organization.updateMany({
      where: { members: { some: { userId, role: 'owner', removedAt: null } } },
      data: { name: changes.creditName },
    });
  }

  async updateAccount({
    userId,
    name,
    termsVersion,
    now,
  }: {
    userId: string;
    name: string | null;
    termsVersion: string | null;
    now: Date;
  }): Promise<void> {
    if (!name && !termsVersion) return;
    await this.db().user.update({
      where: { id: userId },
      data: {
        ...(name ? { name } : {}),
        ...(termsVersion ? { termsVersion, termsAcceptedAt: now } : {}),
      },
    });
  }
}
