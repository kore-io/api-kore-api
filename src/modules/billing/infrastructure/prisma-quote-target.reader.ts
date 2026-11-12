import { Injectable } from '@nestjs/common';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type { QuoteTarget, QuoteTargetReader } from '../application/ports/quote-target.reader.port';

const day = (value: Date | null): string | null => value?.toISOString().slice(0, 10) ?? null;

/** Na transação da requisição, com a RLS do casamento. */
@Injectable()
export class PrismaQuoteTargetReader implements QuoteTargetReader {
  constructor(private readonly tenant: TenantTransaction) {}

  async read({ weddingId }: { weddingId: string }): Promise<QuoteTarget | null> {
    const wedding = await this.tenant.client().wedding.findUnique({
      where: { id: weddingId },
      select: {
        status: true,
        slug: true,
        eventDate: true,
        timezone: true,
        endDate: true,
        paidThrough: true,
        publishedAt: true,
        referrer: { select: { kind: true, status: true, referralDiscountEnabled: true } },
      },
    });
    if (!wedding) return null;
    return {
      status: wedding.status,
      slug: wedding.slug,
      eventDate: day(wedding.eventDate),
      timezone: wedding.timezone,
      endDate: day(wedding.endDate),
      paidThrough: day(wedding.paidThrough),
      publishedAt: wedding.publishedAt,
      referrer: wedding.referrer,
    };
  }

  async referralDiscountPercent(): Promise<number> {
    const settings = await this.tenant.client().referralSettings.findFirstOrThrow({
      select: { referralDiscountPercent: true },
    });
    return settings.referralDiscountPercent;
  }
}
