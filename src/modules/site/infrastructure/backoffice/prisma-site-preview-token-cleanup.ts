import { Injectable } from '@nestjs/common';
import { BackofficePrismaService } from '../../../../shared/database/backoffice-prisma.service';
import type { SitePreviewTokenCleanup } from '../../application/ports/site-preview-token-cleanup.port';

/** Pela conexão do backoffice (sem RLS): a rotina atravessa os casamentos. */
@Injectable()
export class PrismaSitePreviewTokenCleanup implements SitePreviewTokenCleanup {
  constructor(private readonly prisma: BackofficePrismaService) {}

  async deleteCreatedBefore({ before }: { before: Date }): Promise<number> {
    const { count } = await this.prisma.sitePreviewToken.deleteMany({
      where: { createdAt: { lt: before } },
    });
    return count;
  }
}
