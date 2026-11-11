import type { SectionContent, SiteSectionType } from '../../domain/site-sections';

export interface PublicSiteImage {
  id: string;
  storageKey: string;
  thumbKey: string;
  ogKey: string;
  width: number;
  height: number;
}

/**
 * O que a função site_public_by_slug devolve: só o status, fora do ar; as
 * colunas públicas, no ar. Da Cerimônia, só `venueCount` (o recorte do
 * visitante é feito no banco).
 */
export type PublicSiteRow =
  | { status: string; live: false }
  | {
      status: string;
      live: true;
      weddingId: string;
      slug: string;
      eventDate: string | null;
      city: string;
      state: string;
      timezone: string;
      fontPairKey: string;
      primaryColor: string;
      accentColor: string;
      backgroundMode: string;
      coverImageId: string | null;
      partners: string[];
      sections: { type: SiteSectionType; title: string | null; content: SectionContent }[];
      images: PublicSiteImage[];
    };

/** A leitura pública pelo endereço, sem sessão (Site público RN05). */
export interface PublicSiteReader {
  bySlug({ slug }: { slug: string }): Promise<PublicSiteRow | null>;
}

export const PUBLIC_SITE_READER = Symbol('PublicSiteReader');
