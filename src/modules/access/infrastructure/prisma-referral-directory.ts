import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma.service';
import type { ReferralDirectory } from '../application/ports/referral-directory.port';
import type { ReferrerRecord } from '../domain/referral';

/** Leitura pública (sem sessão): indicadores e configurações não têm RLS de casamento. */
@Injectable()
export class PrismaReferralDirectory implements ReferralDirectory {
  constructor(private readonly prisma: PrismaService) {}

  async findByCode({ code }: { code: string }): Promise<ReferrerRecord | null> {
    const referrer = await this.prisma.referrer.findUnique({
      where: { referralCode: code },
      select: {
        referralCode: true,
        kind: true,
        status: true,
        referralDiscountEnabled: true,
        user: { select: { name: true, status: true } },
        planner: { select: { creditName: true } },
      },
    });
    if (!referrer) return null;
    return {
      referralCode: referrer.referralCode,
      kind: referrer.kind,
      status: referrer.status,
      accountStatus: referrer.user.status,
      // Contratos de leitura por tela: Planner.creditName, ou o nome do vendedor.
      displayName:
        referrer.kind === 'planner' ? (referrer.planner?.creditName ?? null) : referrer.user.name,
      referralDiscountEnabled: referrer.referralDiscountEnabled,
    };
  }

  async referralDiscountPercent(): Promise<number> {
    // Linha única, semeada na migration.
    const settings = await this.prisma.referralSettings.findFirstOrThrow({
      select: { referralDiscountPercent: true },
    });
    return settings.referralDiscountPercent;
  }
}
