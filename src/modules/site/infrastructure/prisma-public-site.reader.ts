import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma.service';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type {
  PartyByToken,
  PartySiteView,
  PublicSiteReader,
  PublicSiteRow,
} from '../application/ports/public-site-reader.port';
import { creditNameForSite } from '../../access/domain/planner-profile';
import { LIVE_SITE_STATUSES } from '../domain/public-site';

/**
 * Pela função site_public_by_slug (SECURITY DEFINER de kore_rls): o visitante
 * não tem sessão nem vínculo, e a RLS esconderia o casamento. Nunca pela
 * conexão do backoffice (decisão 207, revisão técnica).
 */
@Injectable()
export class PrismaPublicSiteReader implements PublicSiteReader {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantTransaction,
  ) {}

  async bySlug({ slug }: { slug: string }): Promise<PublicSiteRow | null> {
    const [row] = await this.prisma.$queryRaw<[{ site: Record<string, unknown> | null }]>`
      SELECT site_public_by_slug(${slug}::citext) AS site`;
    const site = row?.site;
    if (!site) return null;
    const status = String(site.status);
    if (!LIVE_SITE_STATUSES.includes(status)) return { status, live: false };
    const live = site as Omit<PublicSiteRow & { live: true }, 'live'>;
    // Assinatura RN03: o predicado do nome, no helper único.
    return {
      ...live,
      plannerCredit: creditNameForSite({ raw: live.plannerCredit }),
      status,
      live: true,
    };
  }

  async plannerCredit(): Promise<string | null> {
    // Na transação da prévia (app.user_id e app.wedding_id), não na conexão comum.
    const [row] = await this.tenant.client().$queryRaw<[{ name: string | null }]>`
      SELECT session_wedding_planner_credit() AS name`;
    return creditNameForSite({ raw: row?.name ?? null });
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
