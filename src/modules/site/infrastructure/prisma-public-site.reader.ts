import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma.service';
import type {
  PartyByToken,
  PartySiteView,
  PublicSiteReader,
  PublicSiteRow,
} from '../application/ports/public-site-reader.port';
import { LIVE_SITE_STATUSES } from '../domain/public-site';

/**
 * Pela função site_public_by_slug (SECURITY DEFINER de kore_rls): o visitante
 * não tem sessão nem vínculo, e a RLS esconderia o casamento. Nunca pela
 * conexão do backoffice (decisão 207, revisão técnica).
 */
@Injectable()
export class PrismaPublicSiteReader implements PublicSiteReader {
  constructor(private readonly prisma: PrismaService) {}

  async bySlug({ slug }: { slug: string }): Promise<PublicSiteRow | null> {
    const [row] = await this.prisma.$queryRaw<[{ site: Record<string, unknown> | null }]>`
      SELECT site_public_by_slug(${slug}::citext) AS site`;
    const site = row?.site;
    if (!site) return null;
    const status = String(site.status);
    if (!LIVE_SITE_STATUSES.includes(status)) return { status, live: false };
    return { ...(site as Omit<PublicSiteRow & { live: true }, 'live'>), status, live: true };
  }

  async partyByToken({ token }: { token: string }): Promise<PartyByToken | null> {
    const [row] = await this.prisma.$queryRaw<[{ party: PartyByToken | null }]>`
      SELECT site_party_by_token(${token}) AS party`;
    return row?.party ?? null;
  }

  async partyView({
    weddingId,
    partyId,
    linkVersion,
  }: {
    weddingId: string;
    partyId: string;
    linkVersion: number;
  }): Promise<PartySiteView | null> {
    const [row] = await this.prisma.$queryRaw<[{ view: PartySiteView | null }]>`
      SELECT site_party_view(${weddingId}::uuid, ${partyId}::uuid, ${linkVersion}::int) AS view`;
    return row?.view ?? null;
  }
}
