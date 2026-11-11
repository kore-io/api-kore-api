import type { PreviewMode } from '../../domain/site-preview';

export interface PreviewCookieClaims {
  userId: string;
  mode: PreviewMode;
  partyId: string | null;
  /** O vencimento fixo (30 minutos da troca), que a troca de modo não estende. */
  expiresAt: Date;
}

/** O cookie da prévia, um por casamento: `kore_site_preview_<weddingId>` (Pré-visualização RN03). */
export interface PreviewCookies {
  name({ weddingId }: { weddingId: string }): string;
  sign({ weddingId, claims }: { weddingId: string; claims: PreviewCookieClaims }): string;
  /** Null com assinatura errada, de outro casamento ou fora do formato (o vencimento é de quem chama). */
  verify({ weddingId, value }: { weddingId: string; value: string }): PreviewCookieClaims | null;
}

export const PREVIEW_COOKIES = Symbol('PreviewCookies');
