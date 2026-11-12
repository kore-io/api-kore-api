import { Inject, Injectable } from '@nestjs/common';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import {
  SECTION_LIMITS,
  imagesInUse,
  normalizeSiteText,
  sectionImageIds,
  type SiteSectionType,
} from '../domain/site-sections';
import {
  SiteFieldsInvalidError,
  SiteImageNotFoundError,
  type SiteFieldIssue,
} from '../domain/site.errors';
import { SITE_IMAGE_STORE, type SiteImageStore } from './ports/site-image-store.port';
import { SITE_READER, type SiteReader } from './ports/site-reader.port';
import { SITE_STORE, type SiteStore } from './ports/site-store.port';
import { validateSectionContent } from './section-content.validation';
import { SiteEditorViews, type SiteEditorSection } from './site-editor-view';

/**
 * PUT …/site/sections/{type} (Seções RN04 a RN13): grava a seção inteira. O
 * `content` é validado pelo DTO do tipo, as imagens precisam ser `ready` deste
 * casamento (decisão 207, item 3) e, na mesma transação, com o lock do
 * casamento, o "em uso" das imagens é recalculado (Imagens do site RN08).
 */
@Injectable()
export class UpdateSiteSection {
  constructor(
    private readonly authorization: WeddingAuthorization,
    private readonly views: SiteEditorViews,
    @Inject(SITE_READER) private readonly reader: SiteReader,
    @Inject(SITE_STORE) private readonly store: SiteStore,
    @Inject(SITE_IMAGE_STORE) private readonly images: SiteImageStore,
  ) {}

  async execute({
    userId,
    weddingId,
    type,
    enabled,
    title,
    content,
    now,
  }: {
    userId: string;
    weddingId: string;
    type: SiteSectionType;
    enabled: boolean;
    title: string | null;
    content: unknown;
    now: Date;
  }): Promise<SiteEditorSection> {
    await this.authorization.require({ userId, weddingId, action: 'manage_site' });

    // A contagem não tem título; as outras, de 1 a 80 (RN02 e RN12).
    const issues: SiteFieldIssue[] = [];
    const cleanTitle = title === null ? null : normalizeSiteText({ value: title });
    if (type === 'countdown') {
      if (cleanTitle !== null) issues.push({ path: 'title', code: 'IS_EMPTY', params: {} });
    } else if (!cleanTitle) issues.push({ path: 'title', code: 'IS_NOT_EMPTY', params: {} });
    else if (cleanTitle.length > SECTION_LIMITS.title)
      issues.push({ path: 'title', code: 'MAX_LENGTH', params: { max: SECTION_LIMITS.title } });
    const validated = await validateSectionContent({ type, content });
    if (!validated.ok) issues.push(...validated.errors);
    if (issues.length > 0 || !validated.ok) throw new SiteFieldsInvalidError({ issues });

    // O mesmo lock do limite, da rotina e dos Dados básicos (S4 RN07 e RN08).
    await this.images.lockWedding({ weddingId });
    const ids = sectionImageIds({ type, content: validated.content });
    const ready = new Set(
      (await this.reader.readyImages({ weddingId, ids })).map((image) => image.id),
    );
    const refused = [...new Set(ids.filter((id) => !ready.has(id)))];
    if (refused.length > 0) throw new SiteImageNotFoundError({ imageIds: refused });

    await this.store.updateSection({
      weddingId,
      type,
      enabled,
      title: cleanTitle,
      content: validated.content,
      now,
    });
    const site = await this.reader.read({ weddingId });
    if (!site) throw new Error('Casamento sem leitura na transação do vínculo.');
    await this.store.markImageUsage({
      weddingId,
      inUse: imagesInUse({ coverImageId: site.coverImageId, sections: site.sections }),
      now,
    });
    const view = await this.views.build({ userId, weddingId });
    const section = view.sections.find((item) => item.type === type);
    if (!section) throw new Error('Seção da F2 sem linha no casamento.');
    return section;
  }
}
