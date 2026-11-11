import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppConfigService } from '../../../shared/config/app-config.service';
import { SITE_PREVIEW_COOKIE_PREFIX } from '../../../shared/http/session-cookie-name';
import type {
  PreviewCookieClaims,
  PreviewCookies,
} from '../application/ports/preview-cookies.port';
import { PREVIEW_MODES, type PreviewMode } from '../domain/site-preview';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `<payload>.<assinatura>` em base64url, com o HMAC-SHA256 da
 * PREVIEW_COOKIE_KEY (separada da do grupo). O payload leva o casamento (que
 * também vai no nome), a pessoa, o modo, o grupo e o vencimento.
 */
@Injectable()
export class HmacPreviewCookies implements PreviewCookies {
  private readonly key: Buffer;

  constructor(config: AppConfigService) {
    this.key = Buffer.from(config.get({ key: 'PREVIEW_COOKIE_KEY' }), 'base64');
  }

  name({ weddingId }: { weddingId: string }): string {
    return `${SITE_PREVIEW_COOKIE_PREFIX}${weddingId}`;
  }

  sign({ weddingId, claims }: { weddingId: string; claims: PreviewCookieClaims }): string {
    const payload = Buffer.from(
      JSON.stringify({
        w: weddingId,
        u: claims.userId,
        m: claims.mode,
        p: claims.partyId,
        e: claims.expiresAt.getTime(),
      }),
    ).toString('base64url');
    return `${payload}.${this.mac(payload)}`;
  }

  verify({ weddingId, value }: { weddingId: string; value: string }): PreviewCookieClaims | null {
    const [payload, signature, extra] = value.split('.');
    if (!payload || !signature || extra !== undefined) return null;
    const expected = Buffer.from(this.mac(payload));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
        string,
        unknown
      >;
      const { w, u, m, p, e } = claims;
      if (w !== weddingId || typeof u !== 'string' || !UUID.test(u)) return null;
      if (!PREVIEW_MODES.includes(m as PreviewMode)) return null;
      if (m === 'party' ? typeof p !== 'string' || !UUID.test(p) : p !== null) return null;
      if (typeof e !== 'number' || !Number.isFinite(e)) return null;
      return {
        userId: u,
        mode: m as PreviewMode,
        partyId: p as string | null,
        expiresAt: new Date(e),
      };
    } catch {
      return null;
    }
  }

  private mac(payload: string): string {
    return createHmac('sha256', this.key).update(payload).digest('base64url');
  }
}
