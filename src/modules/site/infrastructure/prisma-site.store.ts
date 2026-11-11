import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type { SiteBasicsChanges, SiteStore } from '../application/ports/site-store.port';

/** O endereço repetido bate no índice único (migration weddings). */
function isSlugTaken(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    JSON.stringify(error.meta ?? {}).includes('slug')
  );
}

/** Na transação da requisição, com a RLS ligada. */
@Injectable()
export class PrismaSiteStore implements SiteStore {
  constructor(private readonly tenant: TenantTransaction) {}

  async updateBasics({
    weddingId,
    changes,
    now,
  }: {
    weddingId: string;
    changes: SiteBasicsChanges;
    now: Date;
  }): Promise<'updated' | 'slug_taken'> {
    // Um SAVEPOINT: o conflito do índice não pode abortar a transação da requisição.
    const tx = this.tenant.client();
    await tx.$executeRaw`SAVEPOINT site_basics`;
    try {
      await tx.wedding.update({
        where: { id: weddingId },
        data: { ...changes, siteUpdatedAt: now },
        select: { id: true },
      });
      await tx.$executeRaw`RELEASE SAVEPOINT site_basics`;
      return 'updated';
    } catch (error) {
      if (!isSlugTaken(error)) throw error;
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT site_basics`;
      return 'slug_taken';
    }
  }

  async renamePartners({
    weddingId,
    partners,
  }: {
    weddingId: string;
    partners: readonly { id: string; name: string }[];
  }): Promise<void> {
    for (const partner of partners) {
      await this.tenant.client().partner.updateMany({
        where: { id: partner.id, weddingId },
        data: { displayName: partner.name },
      });
    }
  }

  async markImageUsage({
    weddingId,
    inUse,
    now,
  }: {
    weddingId: string;
    inUse: ReadonlySet<string>;
    now: Date;
  }): Promise<void> {
    const ids = [...inUse];
    const tx = this.tenant.client();
    await tx.siteImage.updateMany({
      where: { weddingId, status: 'ready', id: { in: ids }, unusedSince: { not: null } },
      data: { unusedSince: null },
    });
    await tx.siteImage.updateMany({
      where: { weddingId, status: 'ready', id: { notIn: ids }, unusedSince: null },
      data: { unusedSince: now },
    });
  }
}
