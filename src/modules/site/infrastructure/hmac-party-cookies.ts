import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppConfigService } from '../../../shared/config/app-config.service';
import { PARTY_COOKIE_PREFIX } from '../../../shared/http/session-cookie-name';
import type { PartyCookieClaims, PartyCookies } from '../application/ports/party-cookies.port';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `<payload>.<assinatura>`, os dois em base64url. O payload leva o casamento,
 * o grupo e a versão do link (ADR-36, item 1); a assinatura é o HMAC-SHA256
 * dele com a PARTY_COOKIE_KEY. O casamento também vai no nome, e os dois
 * precisam bater: um cookie não serve para outro casamento.
 */
@Injectable()
export class HmacPartyCookies implements PartyCookies {
  private readonly key: Buffer;

  constructor(config: AppConfigService) {
    this.key = Buffer.from(config.get({ key: 'PARTY_COOKIE_KEY' }), 'base64');
  }

  name({ weddingId }: { weddingId: string }): string {
    return `${PARTY_COOKIE_PREFIX}${weddingId}`;
  }

  sign({ weddingId, claims }: { weddingId: string; claims: PartyCookieClaims }): string {
    const payload = Buffer.from(
      JSON.stringify({ w: weddingId, p: claims.partyId, v: claims.linkVersion }),
    ).toString('base64url');
    return `${payload}.${this.mac(payload)}`;
  }

  verify({ weddingId, value }: { weddingId: string; value: string }): PartyCookieClaims | null {
    const [payload, signature, extra] = value.split('.');
    if (!payload || !signature || extra !== undefined) return null;
    const expected = Buffer.from(this.mac(payload));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
        w?: unknown;
        p?: unknown;
        v?: unknown;
      };
      if (claims.w !== weddingId || typeof claims.p !== 'string' || !UUID.test(claims.p))
        return null;
      if (typeof claims.v !== 'number' || !Number.isInteger(claims.v) || claims.v < 1) return null;
      return { partyId: claims.p, linkVersion: claims.v };
    } catch {
      return null;
    }
  }

  private mac(payload: string): string {
    return createHmac('sha256', this.key).update(payload).digest('base64url');
  }
}
