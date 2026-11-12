import { Inject, Injectable } from '@nestjs/common';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import { DEFAULT_SONG_QUESTION, SONG_TEXT_MAX } from '../domain/public-site';
import { SiteFieldsInvalidError } from '../domain/site.errors';
import { SITE_STORE, type SiteStore } from './ports/site-store.port';

/**
 * PUT …/site/song-question (Música RN01 e RN02): a seção Pergunta de música do
 * Editor. `manage_site` (qualquer vínculo). O texto vai sem espaços nas pontas,
 * até 120; vazio volta ao padrão. Desligar só esconde: as sugestões ficam.
 */
@Injectable()
export class UpdateSongQuestion {
  constructor(
    private readonly authorization: WeddingAuthorization,
    @Inject(SITE_STORE) private readonly store: SiteStore,
  ) {}

  async execute({
    userId,
    weddingId,
    enabled,
    text,
    now,
  }: {
    userId: string;
    weddingId: string;
    enabled: boolean;
    text: string | null;
    now: Date;
  }): Promise<{ enabled: boolean; text: string }> {
    await this.authorization.require({ userId, weddingId, action: 'manage_site' });
    const clean = text?.trim() || null;
    if (clean !== null && clean.length > SONG_TEXT_MAX)
      throw new SiteFieldsInvalidError({
        issues: [{ path: 'text', code: 'TOO_LONG', params: { max: SONG_TEXT_MAX } }],
      });
    await this.store.updateSongQuestion({ weddingId, enabled, text: clean, now });
    return { enabled, text: clean ?? DEFAULT_SONG_QUESTION };
  }
}
