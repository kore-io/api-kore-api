import type { SectionContent, SiteSectionType } from '../../domain/site-sections';

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
  /**
   * Grava a Aparência inteira e o `siteUpdatedAt`; o `appearanceSetAt` só na
   * primeira vez (Aparência RN10).
   */
  updateAppearance({
    weddingId,
    appearance,
    now,
  }: {
    weddingId: string;
    appearance: SiteAppearanceChanges;
    now: Date;
  }): Promise<void>;

  /** A pergunta de música (Música RN01): ligada e o texto (nulo = o padrão), com o `siteUpdatedAt`. */
  updateSongQuestion({
    weddingId,
    enabled,
    text,
    now,
  }: {
    weddingId: string;
    enabled: boolean;
    text: string | null;
    now: Date;
  }): Promise<void>;

  /** Grava a seção inteira (ligada, título e o conteúdo `pt-BR`) e o `siteUpdatedAt`. */
  updateSection({
    weddingId,
    type,
    enabled,
    title,
    content,
    now,
  }: {
    weddingId: string;
    type: SiteSectionType;
    enabled: boolean;
    title: string | null;
    content: SectionContent;
    now: Date;
  }): Promise<void>;

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

export interface SiteAppearanceChanges {
  fontPairKey: string;
  starterPaletteKey: string | null;
  primaryColor: string;
  accentColor: string;
  backgroundMode: string;
}

export const SITE_STORE = Symbol('SiteStore');
