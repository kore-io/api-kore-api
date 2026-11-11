import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { AppConfigService } from '../../../shared/config/app-config.service';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import { uuidV7 } from '../../../shared/ids/uuid-v7';
import { PartyLinkFailures } from '../../../shared/rate-limit/party-link-failures';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import {
  PREVIEW_COOKIE_TTL_MS,
  PREVIEW_PARTIES_LIMIT,
  PREVIEW_TOKEN_TTL_MS,
  type PreviewMode,
} from '../domain/site-preview';
import {
  PartyLinkRateLimitedError,
  PreviewInvalidError,
  PreviewRequiredError,
  SitePartyNotFoundError,
  SiteSlugMissingError,
} from '../domain/site.errors';
import { PREVIEW_COOKIES, type PreviewCookies } from './ports/preview-cookies.port';
import { SITE_PREVIEW_STORE, type SitePreviewStore } from './ports/site-preview-store.port';
import { PreviewSessions } from './preview-sessions.service';

const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');

export interface PreviewCookie {
  name: string;
  value: string;
  expiresAt: Date;
}

/**
 * POST /v1/weddings/{weddingId}/site-previews (Pré-visualização RN01 e RN02;
 * rota do app): o token de 128 bits, de uso único, por 5 minutos, guardado só
 * em hash, e a `url` do site com ele (`?previa=`).
 */
@Injectable()
export class CreateSitePreview {
  private readonly siteUrl: string;

  constructor(
    private readonly authorization: WeddingAuthorization,
    @Inject(SITE_PREVIEW_STORE) private readonly store: SitePreviewStore,
    config: AppConfigService,
  ) {
    this.siteUrl = config.get({ key: 'SITE_URL' }).replace(/\/+$/, '');
  }

  async execute({
    userId,
    weddingId,
    mode,
    partyId,
    now,
  }: {
    userId: string;
    weddingId: string;
    mode: PreviewMode;
    partyId: string | null;
    now: Date;
  }): Promise<{ url: string; expiresAt: Date }> {
    await this.authorization.require({ userId, weddingId, action: 'manage_site' });
    const slug = await this.store.slugOf({ weddingId });
    if (!slug) throw new SiteSlugMissingError();
    if (mode === 'party' && !(partyId && (await this.store.activeParty({ weddingId, partyId }))))
      throw new SitePartyNotFoundError();

    const token = randomBytes(16).toString('base64url');
    const expiresAt = new Date(now.getTime() + PREVIEW_TOKEN_TTL_MS);
    await this.store.createToken({
      id: uuidV7({ now: now.getTime() }),
      weddingId,
      userId,
      tokenHash: sha256(token),
      mode,
      partyId: mode === 'party' ? partyId : null,
      expiresAt,
    });
    return { url: `${this.siteUrl}/${slug.toLowerCase()}?previa=${token}`, expiresAt };
  }
}

/**
 * POST /v1/sites/{slug}/preview-session (Pré-visualização RN03 e RN04): troca
 * o token pelo cookie da prévia, de 30 minutos fixos. O token vale se existe,
 * não foi usado, está no prazo, é deste endereço e a pessoa ainda tem
 * `manage_site`; o uso é marcado de forma atômica. Senão, PREVIEW_INVALID,
 * contado no mesmo limite `party_link` (só as falhas).
 */
@Injectable()
export class StartPreviewSession {
  constructor(
    private readonly tenant: TenantTransaction,
    private readonly authorization: WeddingAuthorization,
    @Inject(SITE_PREVIEW_STORE) private readonly store: SitePreviewStore,
    @Inject(PREVIEW_COOKIES) private readonly cookies: PreviewCookies,
    private readonly failures: PartyLinkFailures,
  ) {}

  async execute({
    slug,
    token,
    ip,
    now,
  }: {
    slug: string;
    token: string;
    ip: string;
    now: Date;
  }): Promise<{
    slug: string;
    mode: PreviewMode;
    party: { id: string; name: string } | null;
    cookie: PreviewCookie;
  }> {
    if (await this.failures.isBlocked({ ip })) throw new PartyLinkRateLimitedError();
    const row = await this.store.tokenByHash({ tokenHash: sha256(token) });
    const valid =
      row &&
      !row.usedAt &&
      row.expiresAt.getTime() > now.getTime() &&
      row.slug?.toLowerCase() === slug;
    const result = valid
      ? await this.tenant.run({
          userId: row.userId,
          weddingId: row.weddingId,
          work: async () => {
            const allowed = await this.authorization.can({
              userId: row.userId,
              weddingId: row.weddingId,
              action: 'manage_site',
            });
            if (!allowed || !(await this.store.markUsed({ id: row.id, now }))) return null;
            if (row.mode === 'visitor') return { party: null };
            const party = row.partyId
              ? await this.store.activeParty({ weddingId: row.weddingId, partyId: row.partyId })
              : null;
            return party ? { party } : null;
          },
        })
      : null;
    if (!row || !result) {
      await this.failures.recordFailure({ ip });
      throw new PreviewInvalidError();
    }

    const expiresAt = new Date(now.getTime() + PREVIEW_COOKIE_TTL_MS);
    return {
      slug,
      mode: row.mode,
      party: result.party,
      cookie: {
        name: this.cookies.name({ weddingId: row.weddingId }),
        value: this.cookies.sign({
          weddingId: row.weddingId,
          claims: { userId: row.userId, mode: row.mode, partyId: row.partyId, expiresAt },
        }),
        expiresAt,
      },
    };
  }
}

/**
 * PATCH /v1/sites/{slug}/preview-session (Pré-visualização RN06): troca o modo
 * (visitante ou um grupo) e regrava o cookie com o mesmo vencimento.
 */
@Injectable()
export class UpdatePreviewSession {
  constructor(
    private readonly sessions: PreviewSessions,
    @Inject(SITE_PREVIEW_STORE) private readonly store: SitePreviewStore,
    @Inject(PREVIEW_COOKIES) private readonly cookies: PreviewCookies,
  ) {}

  async execute({
    slug,
    cookies,
    mode,
    partyId,
    now,
  }: {
    slug: string;
    cookies: Record<string, string | undefined>;
    mode: PreviewMode;
    partyId: string | null;
    now: Date;
  }): Promise<{
    mode: PreviewMode;
    party: { id: string; name: string } | null;
    cookie: PreviewCookie;
  }> {
    const found = await this.sessions.within({
      slug,
      cookies,
      now,
      work: async ({ weddingId }) => {
        if (mode === 'visitor') return { party: null };
        const party = partyId ? await this.store.activeParty({ weddingId, partyId }) : null;
        if (!party) throw new SitePartyNotFoundError();
        return { party };
      },
    });
    if (!found) throw new PreviewRequiredError();
    const { weddingId, claims } = found.context;
    const party = found.value.party;
    return {
      mode,
      party,
      cookie: {
        name: this.cookies.name({ weddingId }),
        value: this.cookies.sign({
          weddingId,
          claims: { ...claims, mode, partyId: party?.id ?? null },
        }),
        // Sem estender os 30 minutos (decisão 207, item 8).
        expiresAt: claims.expiresAt,
      },
    };
  }
}

/** GET /v1/sites/{slug}/preview-parties (Pré-visualização RN06): o Select da barra. */
@Injectable()
export class ListPreviewParties {
  constructor(
    private readonly sessions: PreviewSessions,
    @Inject(SITE_PREVIEW_STORE) private readonly store: SitePreviewStore,
  ) {}

  async execute({
    slug,
    cookies,
    q,
    now,
  }: {
    slug: string;
    cookies: Record<string, string | undefined>;
    q: string | null;
    now: Date;
  }): Promise<{ total: number; data: { id: string; name: string }[] }> {
    const found = await this.sessions.within({
      slug,
      cookies,
      now,
      work: ({ weddingId }) =>
        this.store.listParties({ weddingId, q, limit: PREVIEW_PARTIES_LIMIT }),
    });
    if (!found) throw new PreviewRequiredError();
    return found.value;
  }
}
