import { Inject, Injectable } from '@nestjs/common';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from '../../../shared/storage/application/object-storage.port';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import { isSectionEmpty, sectionImageIds, type SiteSectionType } from '../domain/site-sections';
import {
  SITE_READER,
  type ReadySiteImage,
  type SiteReader,
  type SiteSnapshot,
} from './ports/site-reader.port';

export interface SiteImageRef {
  id: string;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
}

export interface SiteEditorSection {
  type: SiteSectionType;
  enabled: boolean;
  empty: boolean;
  title: string | null;
  content: Record<string, unknown>;
}

export interface SiteEditorView extends Omit<
  SiteSnapshot,
  'eventDate' | 'coverImageId' | 'sections'
> {
  eventDate: string | null;
  cover: SiteImageRef | null;
  sections: SiteEditorSection[];
  editable: { names: boolean; eventDate: boolean; state: boolean; slug: boolean };
}

/**
 * A leitura do Editor (GET …/site; Dados básicos RN11), também a resposta do
 * PATCH. As imagens saem só `ready` (decisão 207, item 3), com o endereço do
 * CDN; o conteúdo troca os ids pelas imagens.
 */
@Injectable()
export class SiteEditorViews {
  constructor(
    private readonly authorization: WeddingAuthorization,
    @Inject(SITE_READER) private readonly reader: SiteReader,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async build({
    userId,
    weddingId,
  }: {
    userId: string;
    weddingId: string;
  }): Promise<SiteEditorView> {
    const site = await this.reader.read({ weddingId });
    if (!site) throw new Error('Casamento sem leitura na transação do vínculo.');
    const identity = await this.authorization.canManageSiteIdentity({ userId, weddingId });

    const ids = [
      ...(site.coverImageId ? [site.coverImageId] : []),
      ...site.sections.flatMap((section) => sectionImageIds(section)),
    ];
    const ready = new Map(
      (await this.reader.readyImages({ weddingId, ids })).map((image) => [image.id, image]),
    );
    const ref = (id: string | null): SiteImageRef | null => {
      const image = id ? ready.get(id) : undefined;
      return image ? this.ref(image) : null;
    };
    const readyIds = new Set(ready.keys());

    const { coverImageId, sections, eventDate, ...rest } = site;
    return {
      ...rest,
      eventDate: eventDate ? eventDate.toISOString().slice(0, 10) : null,
      cover: ref(coverImageId),
      sections: sections.map(({ type, enabled, title, content }) => ({
        type,
        enabled,
        empty: isSectionEmpty({ type, content, readyImageIds: readyIds }),
        title,
        content: this.contentView({ type, content, ref }),
      })),
      editable: {
        names: true,
        eventDate: identity,
        state: identity,
        slug: identity && site.publishedAt === null,
      },
    };
  }

  /** Os ids de imagem viram as imagens prontas: `images` em Nossa história e `image` no Dress code. */
  private contentView({
    type,
    content,
    ref,
  }: {
    type: SiteSectionType;
    content: Record<string, unknown>;
    ref: (id: string | null) => SiteImageRef | null;
  }): Record<string, unknown> {
    const ids = sectionImageIds({ type, content });
    const without = (key: string) =>
      Object.fromEntries(Object.entries(content).filter(([name]) => name !== key));
    if (type === 'story')
      return {
        ...without('imageIds'),
        images: ids.map((id) => ref(id)).filter((image) => image !== null),
      };
    if (type === 'dress_code') return { ...without('imageId'), image: ref(ids[0] ?? null) };
    return content;
  }

  private ref(image: ReadySiteImage): SiteImageRef {
    return {
      id: image.id,
      url: this.storage.publicUrl({ key: image.storageKey }),
      thumbUrl: this.storage.publicUrl({ key: image.thumbKey }),
      width: image.width,
      height: image.height,
    };
  }
}

/** GET …/site: a leitura do Editor (Dados básicos RN11). Abrir conta como atividade (interceptor). */
@Injectable()
export class GetSiteEditor {
  constructor(
    private readonly authorization: WeddingAuthorization,
    private readonly views: SiteEditorViews,
  ) {}

  async execute({
    userId,
    weddingId,
  }: {
    userId: string;
    weddingId: string;
  }): Promise<SiteEditorView> {
    await this.authorization.require({ userId, weddingId, action: 'manage_site' });
    return this.views.build({ userId, weddingId });
  }
}
