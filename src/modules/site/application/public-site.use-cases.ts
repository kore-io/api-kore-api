import { Inject, Injectable } from '@nestjs/common';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from '../../../shared/storage/application/object-storage.port';
import { BACKGROUND_MODES, evaluateAppearance, type BackgroundMode } from '../domain/appearance';
import { DRAFT_SITE_STATUSES, coupleNames } from '../domain/public-site';
import { isSectionEmpty, sectionImageIds, type SectionContent } from '../domain/site-sections';
import { SiteDraftError, SiteNotFoundError } from '../domain/site.errors';
import {
  PUBLIC_SITE_READER,
  type PublicSiteImage,
  type PublicSiteReader,
  type PublicSiteRow,
} from './ports/public-site-reader.port';

export interface PublicImage {
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
}

export interface PublicSection {
  type: string;
  title?: string | null;
  /** Só na Cerimônia, para o visitante: o cartão fechado, sem conteúdo (RN05). */
  locked?: boolean;
  content?: Record<string, unknown>;
}

export interface PublicSiteView {
  slug: string;
  names: string;
  eventDate: string | null;
  city: string;
  state: string;
  timezone: string;
  appearance: {
    fontPairKey: string;
    primaryColor: string;
    primaryForeground: string;
    accentColor: string;
    backgroundMode: string;
  };
  cover: { url: string; width: number; height: number } | null;
  viewer: { kind: 'visitor'; party: null; preview: null };
  contact: null;
  sections: PublicSection[];
}

type LiveSite = PublicSiteRow & { live: true };

/**
 * GET /v1/sites/{slug} (Site público RN04 e RN05), como visitante: o recorte é
 * do servidor (a função do banco não devolve locais nem contato). Rascunho é
 * SITE_DRAFT sem dado nenhum; endereço que não existe ou casamento fora do ar,
 * SITE_NOT_FOUND. O grupo identificado (PR do link do grupo) e a prévia vêm depois.
 */
@Injectable()
export class GetPublicSite {
  constructor(
    @Inject(PUBLIC_SITE_READER) private readonly reader: PublicSiteReader,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async execute({ slug }: { slug: string }): Promise<PublicSiteView> {
    const site = await this.reader.bySlug({ slug });
    if (site && !site.live && DRAFT_SITE_STATUSES.includes(site.status)) throw new SiteDraftError();
    if (!site || !site.live) throw new SiteNotFoundError();

    const images = new Map(site.images.map((image) => [image.id, image]));
    const image = (id: string | null): PublicImage | null => {
      const found = id ? images.get(id) : undefined;
      return found ? this.publicImage(found) : null;
    };
    const cover = image(site.coverImageId);
    const backgroundMode: BackgroundMode = BACKGROUND_MODES.includes(
      site.backgroundMode as BackgroundMode,
    )
      ? (site.backgroundMode as BackgroundMode)
      : 'cream';
    return {
      slug: site.slug,
      names: coupleNames({ partners: site.partners }),
      eventDate: site.eventDate,
      city: site.city,
      state: site.state,
      timezone: site.timezone,
      appearance: {
        fontPairKey: site.fontPairKey,
        primaryColor: site.primaryColor,
        primaryForeground: evaluateAppearance({
          primaryColor: site.primaryColor,
          accentColor: site.accentColor,
          backgroundMode,
        }).primaryForeground,
        accentColor: site.accentColor,
        backgroundMode,
      },
      cover: cover && { url: cover.url, width: cover.width, height: cover.height },
      viewer: { kind: 'visitor', party: null, preview: null },
      contact: null,
      sections: this.visitorSections({ site, image }),
    };
  }

  /**
   * Só as ligadas e com conteúdo, na ordem fixa (Seções RN01 e RN03; Site
   * público RN10). No site, a contagem fica no topo, junto dos nomes.
   */
  private visitorSections({
    site,
    image,
  }: {
    site: LiveSite;
    image: (id: string | null) => PublicImage | null;
  }): PublicSection[] {
    const ready = new Set(site.images.map((item) => item.id));
    const ordered = [
      ...site.sections.filter((section) => section.type === 'countdown'),
      ...site.sections.filter((section) => section.type !== 'countdown'),
    ];
    return ordered.flatMap(({ type, title, content }): PublicSection[] => {
      // A contagem some sem data (Seções RN06).
      if (type === 'countdown') return site.eventDate ? [{ type }] : [];
      if (type === 'ceremony')
        return Number(content.venueCount) > 0 ? [{ type, title, locked: true }] : [];
      if (isSectionEmpty({ type, content, readyImageIds: ready })) return [];
      return [{ type, title, content: this.visitorContent({ type, content, image }) }];
    });
  }

  private visitorContent({
    type,
    content,
    image,
  }: {
    type: string;
    content: SectionContent;
    image: (id: string | null) => PublicImage | null;
  }): Record<string, unknown> {
    if (type === 'story')
      return {
        text: content.text,
        images: sectionImageIds({ type, content })
          .map((id) => image(id))
          .filter((item) => item !== null),
      };
    if (type === 'dress_code')
      return {
        text: content.text,
        image: image(sectionImageIds({ type, content })[0] ?? null),
      };
    return content;
  }

  private publicImage(image: PublicSiteImage): PublicImage {
    return {
      url: this.storage.publicUrl({ key: image.storageKey }),
      thumbUrl: this.storage.publicUrl({ key: image.thumbKey }),
      width: image.width,
      height: image.height,
    };
  }
}

export type SiteLinkPreview =
  | {
      state: 'published';
      title: string;
      description: string;
      image: { url: string; width: number; height: number } | null;
    }
  | { state: 'generic'; title: null; description: null; image: null };

/**
 * GET /v1/public/sites/{slug}/preview (Site público RN09): a prévia do link
 * (Open Graph). Nunca local, horário nem data; rascunho e endereço que não
 * existe saem iguais, a prévia genérica do Kore.
 */
@Injectable()
export class GetSiteLinkPreview {
  constructor(
    @Inject(PUBLIC_SITE_READER) private readonly reader: PublicSiteReader,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async execute({ slug }: { slug: string }): Promise<SiteLinkPreview> {
    const site = await this.reader.bySlug({ slug });
    if (!site?.live) return { state: 'generic', title: null, description: null, image: null };
    const names = coupleNames({ partners: site.partners });
    const cover = site.images.find((image) => image.id === site.coverImageId);
    return {
      state: 'published',
      title: names,
      description: `Site do casamento de ${names}.`,
      // A og.jpg, 1200 × 630 e até 300 KB (decisão 207, item 11); nunca a display.jpg.
      image: cover
        ? { url: this.storage.publicUrl({ key: cover.ogKey }), width: 1200, height: 630 }
        : null,
    };
  }
}
