import type { SectionContent, SiteSectionType } from '../../domain/site-sections';

export interface SiteSnapshot {
  status: string;
  publishedAt: Date | null;
  siteUpdatedAt: Date | null;
  partners: { id: string; name: string; title: 'bride' | 'groom' | null }[];
  eventDate: Date | null;
  city: string | null;
  state: string | null;
  timezone: string | null;
  slug: string | null;
  contactWhatsapp: string | null;
  contactEmail: string | null;
  coverImageId: string | null;
  appearance: {
    fontPairKey: string;
    starterPaletteKey: string | null;
    primaryColor: string;
    accentColor: string;
    backgroundMode: string;
  };
  /** As 6 da F2, na ordem fixa, com o conteúdo `pt-BR`. */
  sections: {
    type: SiteSectionType;
    enabled: boolean;
    title: string | null;
    content: SectionContent;
  }[];
}

export interface ReadySiteImage {
  id: string;
  storageKey: string;
  thumbKey: string;
  ogKey: string;
  width: number;
  height: number;
}

/** O site do casamento, na transação da requisição (RLS). */
export interface SiteReader {
  read({ weddingId }: { weddingId: string }): Promise<SiteSnapshot | null>;

  /** As imagens `ready` do casamento entre os ids pedidos (as outras somem da leitura). */
  readyImages({
    weddingId,
    ids,
  }: {
    weddingId: string;
    ids: readonly string[];
  }): Promise<ReadySiteImage[]>;
}

export const SITE_READER = Symbol('SiteReader');
