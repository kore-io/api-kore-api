import { Inject, Injectable } from '@nestjs/common';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import { SITE_PREVIEW_COOKIE_PREFIX } from '../../../shared/http/session-cookie-name';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import {
  PREVIEW_COOKIES,
  type PreviewCookieClaims,
  type PreviewCookies,
} from './ports/preview-cookies.port';
import { SITE_PREVIEW_STORE, type SitePreviewStore } from './ports/site-preview-store.port';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PreviewContext {
  weddingId: string;
  claims: PreviewCookieClaims;
}

/**
 * O cookie da prévia do casamento do endereço (Pré-visualização RN03 e RN05).
 * Há um cookie por casamento, então o de outro casamento é ignorado. A cada
 * uso: a assinatura e o vencimento fixo, e, na transação com o userId do
 * cookie (a RLS é a segunda barreira), se a pessoa ainda tem `manage_site` e
 * se o endereço é o do casamento. O trabalho roda nessa mesma transação.
 */
@Injectable()
export class PreviewSessions {
  constructor(
    private readonly tenant: TenantTransaction,
    private readonly authorization: WeddingAuthorization,
    @Inject(SITE_PREVIEW_STORE) private readonly store: SitePreviewStore,
    @Inject(PREVIEW_COOKIES) private readonly cookies: PreviewCookies,
  ) {}

  /** Null quando nenhum cookie vale para este endereço (ou o trabalho devolve null). */
  async within<T>({
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
    for (const [name, value] of Object.entries(cookies)) {
      if (!name.startsWith(SITE_PREVIEW_COOKIE_PREFIX) || !value) continue;
      const weddingId = name.slice(SITE_PREVIEW_COOKIE_PREFIX.length);
      if (!UUID.test(weddingId)) continue;
      const claims = this.cookies.verify({ weddingId, value });
      if (!claims || claims.expiresAt.getTime() <= now.getTime()) continue;
      const context = { weddingId, claims };
      const result = await this.tenant.run({
        userId: claims.userId,
        weddingId,
        work: async () => {
          const allowed = await this.authorization.can({
            userId: claims.userId,
            weddingId,
            action: 'manage_site',
          });
          if (!allowed) return null;
          if ((await this.store.slugOf({ weddingId }))?.toLowerCase() !== slug) return null;
          const output = await work(context);
          return output === null ? null : { value: output };
        },
      });
      if (result) return { context, value: result.value };
    }
    return null;
  }
}
