import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma.service';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type { SlugRegistry } from '../application/ports/slug-registry.port';

/**
 * Pela função wedding_slug_taken (SECURITY DEFINER): a RLS esconde os casamentos
 * dos outros, e a função só responde sim ou não. Fora da transação da
 * requisição, para responder mesmo depois de uma corrida no UNIQUE.
 */
@Injectable()
export class PrismaSlugRegistry implements SlugRegistry {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantTransaction,
  ) {}

  async isTaken({ slug }: { slug: string }): Promise<boolean> {
    const [row] = await this.prisma.$queryRaw<[{ taken: boolean }]>`
      SELECT wedding_slug_taken(${slug}::citext) AS taken`;
    return row.taken;
  }

  async currentSlugOf({ weddingId }: { weddingId: string }): Promise<string | null> {
    const wedding = await this.tenant
      .client()
      .wedding.findFirst({ where: { id: weddingId }, select: { slug: true } });
    return wedding?.slug ?? null;
  }
}
