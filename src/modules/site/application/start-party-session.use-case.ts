import { Inject, Injectable } from '@nestjs/common';
import { PartyLinkFailures } from '../../../shared/rate-limit/party-link-failures';
import { DRAFT_SITE_STATUSES, LIVE_SITE_STATUSES } from '../domain/public-site';
import {
  PartyLinkRateLimitedError,
  SiteDraftError,
  SiteLinkInvalidError,
  SiteNotFoundError,
} from '../domain/site.errors';
import { PARTY_COOKIES, type PartyCookies } from './ports/party-cookies.port';
import { PARTY_VISITS, type PartyVisits } from './ports/party-visits.port';
import { PUBLIC_SITE_READER, type PublicSiteReader } from './ports/public-site-reader.port';

export interface PartySession {
  /** O endereço do casamento do token: se for outro, o site vai para ele. */
  slug: string;
  party: { name: string };
  cookie: { name: string; value: string };
}

/**
 * POST /v1/sites/{slug}/party-session (Site público RN06; ADR-36): troca o
 * token do link do grupo pelo cookie assinado do grupo.
 *
 * - Rascunho (do casamento do token ou do endereço) vem antes do endereço
 *   errado, para não revelar o endereço de um rascunho, e é a mesma resposta
 *   com token válido ou não, sem cookie.
 * - O limite `party_link` conta só as falhas (LINK_INVALID e SITE_NOT_FOUND):
 *   olhado antes de resolver, incrementado depois, só na falha.
 * - Convite visualizado (RSVP RN02; decisão 216, D12): só esta troca grava,
 *   pela transação do grupo; entrar pelo cookie, a prévia e o GET da prévia
 *   do link não gravam nada.
 */
@Injectable()
export class StartPartySession {
  constructor(
    @Inject(PUBLIC_SITE_READER) private readonly reader: PublicSiteReader,
    @Inject(PARTY_COOKIES) private readonly cookies: PartyCookies,
    private readonly failures: PartyLinkFailures,
    @Inject(PARTY_VISITS) private readonly visits: PartyVisits,
  ) {}

  async execute({
    slug,
    token,
    ip,
  }: {
    slug: string;
    token: string;
    ip: string;
  }): Promise<PartySession> {
    if (await this.failures.isBlocked({ ip })) throw new PartyLinkRateLimitedError();

    const [party, site] = await Promise.all([
      this.reader.partyByToken({ token }),
      this.reader.bySlug({ slug }),
    ]);
    const isDraft = (status: string | undefined) =>
      status !== undefined && DRAFT_SITE_STATUSES.includes(status);
    if (isDraft(party?.status) || (site && !site.live && isDraft(site.status)))
      throw new SiteDraftError();

    if (party && party.slug && LIVE_SITE_STATUSES.includes(party.status)) {
      await this.visits.markViewed({
        weddingId: party.weddingId,
        partyId: party.partyId,
        linkVersion: party.linkVersion,
      });
      return {
        slug: party.slug,
        party: { name: party.partyName },
        cookie: {
          name: this.cookies.name({ weddingId: party.weddingId }),
          value: this.cookies.sign({
            weddingId: party.weddingId,
            claims: { partyId: party.partyId, linkVersion: party.linkVersion },
          }),
        },
      };
    }

    await this.failures.recordFailure({ ip });
    // Site publicado e token que não resolve: o link não funciona mais.
    if (!party && site?.live) throw new SiteLinkInvalidError();
    throw new SiteNotFoundError();
  }
}
