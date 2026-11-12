import { Injectable } from '@nestjs/common';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type {
  ReadySiteImage,
  SiteReader,
  SiteSnapshot,
} from '../application/ports/site-reader.port';
import {
  SITE_SECTION_TYPES,
  type SectionContent,
  type SiteSectionType,
} from '../domain/site-sections';

const LOCALE = 'pt-BR';

/** Na transação da requisição, com a RLS ligada. */
@Injectable()
export class PrismaSiteReader implements SiteReader {
  constructor(private readonly tenant: TenantTransaction) {}

  async read({ weddingId }: { weddingId: string }): Promise<SiteSnapshot | null> {
    const wedding = await this.tenant.client().wedding.findFirst({
      where: { id: weddingId },
      include: {
        partners: { orderBy: { slot: 'asc' } },
        sections: {
          where: { type: { in: [...SITE_SECTION_TYPES] } },
          orderBy: { position: 'asc' },
          include: { contents: { where: { locale: LOCALE } } },
        },
      },
    });
    if (!wedding) return null;
    return {
      status: wedding.status,
      publishedAt: wedding.publishedAt,
      endDate: wedding.endDate,
      siteUpdatedAt: wedding.siteUpdatedAt,
      partners: wedding.partners.map((partner) => ({
        id: partner.id,
        name: partner.displayName,
        title: partner.title,
      })),
      eventDate: wedding.eventDate,
      city: wedding.city,
      state: wedding.state,
      timezone: wedding.timezone,
      slug: wedding.slug,
      contactWhatsapp: wedding.contactWhatsapp,
      contactEmail: wedding.contactEmail,
      coverImageId: wedding.coverImageId,
      songQuestion: { enabled: wedding.songQuestionEnabled, text: wedding.songQuestionText },
      // Fora da lápide, a aparência nunca é nula (chk_weddings_site_tombstone).
      appearance: {
        fontPairKey: wedding.fontPairKey ?? 'romantico',
        starterPaletteKey: wedding.starterPaletteKey,
        primaryColor: wedding.primaryColor ?? '#A94F37',
        accentColor: wedding.accentColor ?? '#7A8B69',
        backgroundMode: wedding.backgroundMode ?? 'cream',
      },
      sections: wedding.sections.map((section) => ({
        type: section.type as SiteSectionType,
        enabled: section.enabled,
        title: section.title,
        content: (section.contents[0]?.content ?? {}) as SectionContent,
      })),
    };
  }

  async readyImages({
    weddingId,
    ids,
  }: {
    weddingId: string;
    ids: readonly string[];
  }): Promise<ReadySiteImage[]> {
    if (ids.length === 0) return [];
    const images = await this.tenant.client().siteImage.findMany({
      where: { weddingId, status: 'ready', id: { in: [...ids] } },
      select: {
        id: true,
        storageKey: true,
        thumbKey: true,
        ogKey: true,
        width: true,
        height: true,
      },
    });
    // `ready` sempre tem as versões e as medidas (chk_site_images_ready).
    return images.map((image) => ({
      id: image.id,
      storageKey: image.storageKey,
      thumbKey: image.thumbKey ?? image.storageKey,
      ogKey: image.ogKey ?? image.storageKey,
      width: image.width ?? 0,
      height: image.height ?? 0,
    }));
  }
}
