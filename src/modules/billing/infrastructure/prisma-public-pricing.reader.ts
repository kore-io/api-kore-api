import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma.service';

/** Leitura pública (sem sessão): as configurações da indicação não têm RLS de casamento. */
@Injectable()
export class PrismaPublicPricingReader {
  constructor(private readonly prisma: PrismaService) {}

  async referralDiscountPercent(): Promise<number> {
    // Linha única, semeada na migration.
    const settings = await this.prisma.referralSettings.findFirstOrThrow({
      select: { referralDiscountPercent: true },
    });
    return settings.referralDiscountPercent;
  }
}
