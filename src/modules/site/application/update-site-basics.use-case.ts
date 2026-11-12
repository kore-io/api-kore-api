import {
  APPLICATION_LOG_WRITER,
  type ApplicationLogWriter,
} from '../../logs/application/ports/application-log-writer.port';
import { Inject, Injectable } from '@nestjs/common';
import { CheckSlugAvailability } from '../../access/application/check-slug-availability.use-case';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import { timezoneForState, type BrazilianState } from '../../access/domain/wedding-signup';
import { parsePhone } from '../../guests/domain/phone';
import { imagesInUse } from '../domain/site-sections';
import { endDateRange, isEndDateInRange } from '../domain/publication';
import {
  EndDateOutOfRangeError,
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
  /** A assinatura da assessoria no rodapé (Assinatura RN05): só o dono muda. */
  showPlannerCredit?: boolean;
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
    @Inject(APPLICATION_LOG_WRITER) private readonly log: ApplicationLogWriter,
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
    const role = await this.authorization.require({ userId, weddingId, action: 'manage_site' });
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
    // Assinatura RN05: o valor igual ao atual não é erro, como nos outros campos.
    const creditChanged =
      input.showPlannerCredit !== undefined && input.showPlannerCredit !== site.showPlannerCredit;
    const notAllowed: string[] = [];
    if (
      identityFields.length > 0 &&
      !(await this.authorization.canManageSiteIdentity({ userId, weddingId }))
    )
      notAllowed.push(...identityFields);
    if (
      creditChanged &&
      !(await this.authorization.can({ userId, weddingId, action: 'manage_planner_credit' }))
    )
      notAllowed.push('showPlannerCredit');
    if (notAllowed.length > 0) throw new SiteFieldNotAllowedError({ fields: notAllowed });

    const issues: SiteFieldIssue[] = [];
    const changes: SiteBasicsChanges = {};
    if (changed.eventDate) changes.eventDate = toDate(input.eventDate ?? null);
    // Decisão 219 (Publicação RN11): publicado, a data não fica em branco.
    if (changed.eventDate && changes.eventDate === null && site.endDate)
      issues.push({ path: 'eventDate', code: 'EVENT_DATE_REQUIRED_WHEN_PUBLISHED', params: {} });
    if (input.city !== undefined) changes.city = input.city;
    if (changed.state && input.state) {
      changes.state = input.state;
      changes.timezone = timezoneForState({ state: input.state });
    }
    if (input.contactEmail !== undefined) changes.contactEmail = input.contactEmail;
    if (creditChanged) changes.showPlannerCredit = input.showPlannerCredit;
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

    // Publicação RN11 (revisão técnica R1-5): num casamento publicado, a data
    // nova não pode deixar a data de saída do ar fora dos limites da RN04. A
    // data em branco já foi recusada acima (decisão 219).
    if (changed.eventDate && site.endDate) {
      const range = endDateRange({
        eventDate: dayOf(changes.eventDate ?? null),
        timezone: changes.timezone ?? site.timezone,
      });
      if (!range || !isEndDateInRange({ endDate: dayOf(site.endDate)!, range }))
        throw new EndDateOutOfRangeError({
          endDateMin: range?.min ?? null,
          endDateMax: range?.max ?? null,
        });
    }

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
    if (creditChanged)
      await this.log.record({
        entry: {
          action: 'wedding.planner_credit_changed',
          actorKind: 'user',
          actorUserId: userId,
          weddingId,
          entityType: 'wedding',
          entityId: weddingId,
          data: { show: input.showPlannerCredit },
        },
      });
    // Novo casamento RN08 (decisão 223, D10): a data, a UF e o endereço mudados
    // por quem não é dono (o indicador antes do aceite) vão para o log.
    if (role !== 'owner' && identityFields.length > 0)
      await this.log.record({
        entry: {
          action: 'wedding.identity_changed',
          actorKind: 'user',
          actorUserId: userId,
          weddingId,
          entityType: 'wedding',
          entityId: weddingId,
          data: { fields: identityFields },
        },
      });
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
