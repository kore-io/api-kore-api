import { Inject, Injectable } from '@nestjs/common';
import {
  PartySiteNotLiveError,
  PartyTransactionRevokedError,
  TenantTransaction,
  type PartyTransactionContext,
} from '../../../shared/database/tenant-transaction';
import { requireLiveSite } from '../../site/domain/public-site';
import { SiteExpiredError, SiteUnavailableError } from '../../site/domain/site.errors';
import { PARTY_COOKIES, type PartyCookies } from '../../site/application/ports/party-cookies.port';
import {
  PUBLIC_SITE_READER,
  type PublicSiteReader,
} from '../../site/application/ports/public-site-reader.port';
import {
  PreviewSessions,
  type PreviewContext,
} from '../../site/application/preview-sessions.service';
import { PartySessionInvalidError, RsvpSiteNotLiveError } from '../domain/rsvp.errors';

export interface RsvpPartySession {
  weddingId: string;
  partyId: string;
  linkVersion: number;
}

/**
 * Quem está no RSVP (RN01 e RN13): o endereço vale para um site no ar (o
 * rascunho é a página de rascunho, S5 RN04); a prévia do casamento vem antes
 * (o cookie da prévia, `kore_site_preview_*`); depois o cookie do grupo
 * (`kore_party_<weddingId>`), conferido de novo dentro da transação do grupo.
 */
@Injectable()
export class RsvpSessions {
  constructor(
    @Inject(PUBLIC_SITE_READER) private readonly sites: PublicSiteReader,
    @Inject(PARTY_COOKIES) private readonly partyCookies: PartyCookies,
    private readonly previews: PreviewSessions,
    private readonly tenant: TenantTransaction,
  ) {}

  /** O casamento no ar do endereço; rascunho, expirado, bloqueado e inexistente saem como no site. */
  async liveWedding({ slug }: { slug: string }): Promise<string> {
    const site = await this.sites.bySlug({ slug });
    requireLiveSite(site);
    return site.weddingId;
  }

  /**
   * O mesmo, para gravar a resposta (Data de saída do ar RN07): no site
   * expirado ou bloqueado, a recusa do RSVP (409 SITE_EXPIRED · 423).
   */
  async liveWeddingToAnswer({ slug }: { slug: string }): Promise<string> {
    try {
      return await this.liveWedding({ slug });
    } catch (error) {
      if (error instanceof SiteExpiredError) throw new RsvpSiteNotLiveError('expired');
      if (error instanceof SiteUnavailableError) throw new RsvpSiteNotLiveError('unavailable');
      throw error;
    }
  }

  /** A prévia como grupo (Pré-visualização RN07): o trabalho roda na transação do vínculo. */
  preview<T>({
    slug,
    cookies,
    now,
    work,
  }: {
    slug: string;
    cookies: Record<string, string | undefined>;
    now: Date;
    work: (context: PreviewContext) => Promise<T | null>;
  }): Promise<{ context: PreviewContext; value: T } | null> {
    return this.previews.within({ slug, cookies, now, work });
  }

  /** O grupo do cookie, sem consultar o banco; sem cookie válido, 401. */
  party({
    weddingId,
    cookies,
  }: {
    weddingId: string;
    cookies: Record<string, string | undefined>;
  }): RsvpPartySession {
    const value = cookies[this.partyCookies.name({ weddingId })];
    const claims = value ? this.partyCookies.verify({ weddingId, value }) : null;
    if (!claims) throw new PartySessionInvalidError();
    return { weddingId, ...claims };
  }

  /** A transação do grupo; o grupo que deixou de valer (link, lixeira, fora do ar) é 401. */
  async asParty<T>({
    session,
    work,
  }: {
    session: RsvpPartySession;
    work: (context: PartyTransactionContext) => Promise<T>;
  }): Promise<T> {
    try {
      return await this.tenant.runAsParty({ ...session, work });
    } catch (error) {
      if (error instanceof PartyTransactionRevokedError) throw new PartySessionInvalidError();
      // Data de saída do ar RN07 e RN08: o RSVP fecha no site fora do ar.
      if (error instanceof PartySiteNotLiveError) throw new RsvpSiteNotLiveError(error.state);
      throw error;
    }
  }
}
