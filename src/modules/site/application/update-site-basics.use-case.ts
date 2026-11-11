import { Inject, Injectable } from '@nestjs/common';
import { CheckSlugAvailability } from '../../access/application/check-slug-availability.use-case';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import { timezoneForState, type BrazilianState } from '../../access/domain/wedding-signup';
import { parsePhone } from '../../guests/domain/phone';
import { imagesInUse } from '../domain/site-sections';
import {
  SiteFieldNotAllowedError,
  SiteFieldsInvalidError,
  SiteImageNotFoundError,
  SiteSlugLockedError,
  SiteSlugUnavailableError,
  type SiteFieldIssue,
} from '../domain/site.errors';
import { SITE_IMAGE_STORE, type SiteImageStore } from './ports/site-image-store.port';
import { SITE_READER, type SiteReader } from './ports/site-reader.port';
import { SITE_STORE, type SiteBasicsChanges, type SiteStore } from './ports/site-store.port';
import { SiteEditorViews, type SiteEditorView } from './site-editor-view';

/** O que o PATCH pode trazer; ausente não muda (Dados básicos RN02). */
export interface SiteBasicsInput {
  partners?: { id: string; name: string }[];
  /** `AAAA-MM-DD` ou null. */
  eventDate?: string | null;
  city?: string;
  state?: BrazilianState;
  /** Já em minúsculas (DTO). */
  slug?: string;
  contactWhatsapp?: string | null;
  contactEmail?: string | null;
  coverImageId?: string | null;
}

const toDate = (value: string | null): Date | null =>
  value === null ? null : new Date(`${value}T00:00:00Z`);
const dayOf = (date: Date | null): string | null => (date ? date.toISOString().slice(0, 10) : null);

/**
 * PATCH …/site: os Dados básicos do Editor (Dados básicos RN02 a RN10).
 * `manage_site` para o pedido; a data, a UF e o endereço só mudam com
 * `manage_site_identity`, e o valor igual ao atual não é erro (RN04). O
 * endereço só muda em rascunho (RN05). Na mesma transação, com o lock do
 * casamento, o "em uso" das imagens é recalculado (Imagens do site RN08).
 */
@Injectable()
export class UpdateSiteBasics {
  constructor(
    private readonly authorization: WeddingAuthorization,
    private readonly slugAvailability: CheckSlugAvailability,
    private readonly views: SiteEditorViews,
    @Inject(SITE_READER) private readonly reader: SiteReader,
    @Inject(SITE_STORE) private readonly store: SiteStore,
    @Inject(SITE_IMAGE_STORE) private readonly images: SiteImageStore,
  ) {}

  async execute({
    userId,
    weddingId,
    input,
    now,
  }: {
    userId: string;
    weddingId: string;
    input: SiteBasicsInput;
    now: Date;
  }): Promise<SiteEditorView> {
    await this.authorization.require({ userId, weddingId, action: 'manage_site' });
    // O mesmo lock do limite, da rotina de limpeza e das seções (S4 RN07 e RN08).
    await this.images.lockWedding({ weddingId });
    const site = await this.reader.read({ weddingId });
    if (!site) throw new Error('Casamento sem leitura na transação do vínculo.');

    // RN04: só o que muda de verdade pede a ação de identidade.
    const changed = {
      eventDate: input.eventDate !== undefined && input.eventDate !== dayOf(site.eventDate),
      state: input.state !== undefined && input.state !== site.state,
      slug: input.slug !== undefined && input.slug !== site.slug?.toLowerCase(),
    };
    const identityFields = (Object.keys(changed) as (keyof typeof changed)[]).filter(
      (field) => changed[field],
    );
    if (
      identityFields.length > 0 &&
      !(await this.authorization.canManageSiteIdentity({ userId, weddingId }))
    )
      throw new SiteFieldNotAllowedError({ fields: identityFields });

    const issues: SiteFieldIssue[] = [];
    const changes: SiteBasicsChanges = {};
    if (changed.eventDate) changes.eventDate = toDate(input.eventDate ?? null);
    if (input.city !== undefined) changes.city = input.city;
    if (changed.state && input.state) {
      changes.state = input.state;
      changes.timezone = timezoneForState({ state: input.state });
    }
    if (input.contactEmail !== undefined) changes.contactEmail = input.contactEmail;
    if (input.contactWhatsapp !== undefined) {
      if (input.contactWhatsapp === null) changes.contactWhatsapp = null;
      else {
        const phone = parsePhone({ raw: input.contactWhatsapp });
        if (phone.ok) changes.contactWhatsapp = phone.e164;
        else issues.push({ path: 'contactWhatsapp', code: phone.code, params: phone.params });
      }
    }
    const partnerIds = new Set(site.partners.map((partner) => partner.id));
    input.partners?.forEach((partner, index) => {
      if (!partnerIds.has(partner.id))
        issues.push({ path: `partners.${index}.id`, code: 'PARTNER_NOT_FOUND', params: {} });
    });

    if (changed.slug && input.slug) {
      // RN05: depois de publicado, o endereço não muda mais.
      if (site.publishedAt !== null) throw new SiteSlugLockedError();
      const availability = await this.slugAvailability.execute({
        slug: input.slug,
        eventDate: changes.eventDate !== undefined ? changes.eventDate : site.eventDate,
        weddingId,
      });
      if (availability.reason === 'invalid_format')
        issues.push({ path: 'slug', code: 'SLUG_INVALID_FORMAT', params: {} });
      else if (availability.reason)
        throw new SiteSlugUnavailableError({
          reason: availability.reason,
          suggestion: availability.suggestion,
        });
      else changes.slug = input.slug;
    }
    if (issues.length > 0) throw new SiteFieldsInvalidError({ issues });

    if (input.coverImageId !== undefined) {
      if (input.coverImageId !== null) {
        const [cover] = await this.reader.readyImages({ weddingId, ids: [input.coverImageId] });
        if (!cover) throw new SiteImageNotFoundError();
      }
      changes.coverImageId = input.coverImageId;
    }

    if ((await this.store.updateBasics({ weddingId, changes, now })) === 'slug_taken') {
      // Outro casamento pegou o endereço entre a conferência e a gravação.
      const availability = await this.slugAvailability.execute({
        slug: changes.slug ?? '',
        eventDate: site.eventDate,
      });
      throw new SiteSlugUnavailableError({ reason: 'taken', suggestion: availability.suggestion });
    }
    if (input.partners?.length)
      await this.store.renamePartners({ weddingId, partners: input.partners });
    await this.store.markImageUsage({
      weddingId,
      inUse: imagesInUse({
        coverImageId: changes.coverImageId !== undefined ? changes.coverImageId : site.coverImageId,
        sections: site.sections,
      }),
      now,
    });
    return this.views.build({ userId, weddingId });
  }
}
