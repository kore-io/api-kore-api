export interface SiteBasicsChanges {
  eventDate?: Date | null;
  city?: string;
  state?: string;
  timezone?: string;
  slug?: string;
  contactWhatsapp?: string | null;
  contactEmail?: string | null;
  coverImageId?: string | null;
}

/** Gravações do Editor do site, na transação da requisição (RLS). */
export interface SiteStore {
  /**
   * Grava os Dados básicos e o `siteUpdatedAt`. Devolve `slug_taken` quando o
   * índice único recusa o endereço (corrida com outro casamento).
   */
  updateBasics({
    weddingId,
    changes,
    now,
  }: {
    weddingId: string;
    changes: SiteBasicsChanges;
    now: Date;
  }): Promise<'updated' | 'slug_taken'>;

  renamePartners({
    weddingId,
    partners,
  }: {
    weddingId: string;
    partners: readonly { id: string; name: string }[];
  }): Promise<void>;

  /**
   * O "em uso" das imagens, recalculado por inteiro (Imagens do site RN08):
   * `unusedSince` nulo nas em uso e `now` nas `ready` que acabaram de sair.
   */
  markImageUsage({
    weddingId,
    inUse,
    now,
  }: {
    weddingId: string;
    inUse: ReadonlySet<string>;
    now: Date;
  }): Promise<void>;
}

export const SITE_STORE = Symbol('SiteStore');
