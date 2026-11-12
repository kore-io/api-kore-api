import type { PreviewMode } from '../../domain/site-preview';

export interface PreviewTokenRow {
  id: string;
  weddingId: string;
  slug: string | null;
  userId: string;
  mode: PreviewMode;
  partyId: string | null;
  expiresAt: Date;
  usedAt: Date | null;
}

/** Tokens e grupos da prévia (Pré-visualização RN02 a RN06). */
export interface SitePreviewStore {
  /** Pelo hash, antes de saber de quem é o token (função SECURITY DEFINER). */
  tokenByHash({ tokenHash }: { tokenHash: string }): Promise<PreviewTokenRow | null>;

  /** Na transação da requisição (RLS): a pessoa grava o token dela. */
  createToken({
    id,
    weddingId,
    userId,
    tokenHash,
    mode,
    partyId,
    expiresAt,
  }: {
    id: string;
    weddingId: string;
    userId: string;
    tokenHash: string;
    mode: PreviewMode;
    partyId: string | null;
    expiresAt: Date;
  }): Promise<void>;

  /** Uso único, atômico: só um uso de um token dentro do prazo (RLS). Devolve se marcou. */
  markUsed({ id, now }: { id: string; now: Date }): Promise<boolean>;

  /** O grupo do casamento, fora da lixeira (RLS). */
  activeParty({
    weddingId,
    partyId,
  }: {
    weddingId: string;
    partyId: string;
  }): Promise<{ id: string; name: string } | null>;

  /** Os grupos para o Select, em ordem alfabética, sem acento na busca (RLS). */
  listParties({
    weddingId,
    q,
    limit,
  }: {
    weddingId: string;
    q: string | null;
    limit: number;
  }): Promise<{ total: number; data: { id: string; name: string }[] }>;

  /** O endereço atual do casamento (RLS). */
  slugOf({ weddingId }: { weddingId: string }): Promise<string | null>;
}

export const SITE_PREVIEW_STORE = Symbol('SitePreviewStore');
