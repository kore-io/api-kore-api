import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database/prisma.service';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type {
  PreviewTokenRow,
  SitePreviewStore,
} from '../application/ports/site-preview-store.port';
import type { PreviewMode } from '../domain/site-preview';

/** `%texto%` para o LIKE, com os curingas escapados (como a lista de grupos). */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** A leitura pelo hash é pela função do banco; o resto, na transação com a RLS. */
@Injectable()
export class PrismaSitePreviewStore implements SitePreviewStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantTransaction,
  ) {}

  async tokenByHash({ tokenHash }: { tokenHash: string }): Promise<PreviewTokenRow | null> {
    const [row] = await this.prisma.$queryRaw<
      [
        {
          token:
            | (Omit<PreviewTokenRow, 'expiresAt' | 'usedAt'> & {
                expiresAt: string;
                usedAt: string | null;
              })
            | null;
        },
      ]
    >`SELECT site_preview_by_hash(${tokenHash}) AS token`;
    const token = row?.token;
    if (!token) return null;
    return {
      ...token,
      expiresAt: new Date(token.expiresAt),
      usedAt: token.usedAt ? new Date(token.usedAt) : null,
    };
  }

  async createToken({
    id,
    weddingId,
    userId,
    tokenHash,
    mode,
    partyId,
    expiresAt,
  }: {
    id: string;
    weddingId: string;
    userId: string;
    tokenHash: string;
    mode: PreviewMode;
    partyId: string | null;
    expiresAt: Date;
  }): Promise<void> {
    await this.tenant.client().sitePreviewToken.create({
      data: { id, weddingId, userId, tokenHash, mode, partyId, expiresAt },
      select: { id: true },
    });
  }

  async markUsed({ id, now }: { id: string; now: Date }): Promise<boolean> {
    const { count } = await this.tenant.client().sitePreviewToken.updateMany({
      where: { id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    return count === 1;
  }

  activeParty({
    weddingId,
    partyId,
  }: {
    weddingId: string;
    partyId: string;
  }): Promise<{ id: string; name: string } | null> {
    return this.tenant.client().party.findFirst({
      where: { id: partyId, weddingId, deletedAt: null },
      select: { id: true, name: true },
    });
  }

  async listParties({
    weddingId,
    q,
    limit,
  }: {
    weddingId: string;
    q: string | null;
    limit: number;
  }): Promise<{ total: number; data: { id: string; name: string }[] }> {
    const search = q
      ? Prisma.sql`AND lower(f_unaccent(p.name)) LIKE lower(f_unaccent(${likePattern(q)})) ESCAPE '\\'`
      : Prisma.empty;
    const tx = this.tenant.client();
    const [{ total }] = await tx.$queryRaw<[{ total: number }]>`
      SELECT count(*)::int AS total FROM parties p
      WHERE p.wedding_id = ${weddingId}::uuid AND p.deleted_at IS NULL ${search}`;
    const data = await tx.$queryRaw<{ id: string; name: string }[]>`
      SELECT p.id, p.name FROM parties p
      WHERE p.wedding_id = ${weddingId}::uuid AND p.deleted_at IS NULL ${search}
      ORDER BY lower(f_unaccent(p.name)), p.id
      LIMIT ${limit}`;
    return { total, data };
  }

  async slugOf({ weddingId }: { weddingId: string }): Promise<string | null> {
    const wedding = await this.tenant
      .client()
      .wedding.findFirst({ where: { id: weddingId }, select: { slug: true } });
    return wedding?.slug ?? null;
  }
}
