import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../shared/config/app-config.service';
import { AFTER_COMMIT, type AfterCommit } from '../../../shared/database/after-commit.port';
import { daysBetween, localDate } from '../../../shared/time/local-date';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import {
  APPLICATION_LOG_WRITER,
  type ApplicationLogWriter,
} from '../../logs/application/ports/application-log-writer.port';
import {
  PRODUCT_EVENT_RECORDER,
  type ProductEventRecorder,
} from '../../product-events/application/ports/product-event-recorder.port';
import { endDateRange, isEndDateInRange } from '../domain/publication';
import {
  CourtesyDisabledError,
  EndDateOutOfRangeError,
  EventDateMissingError,
  NotDraftError,
  SiteSlugMissingError,
} from '../domain/site.errors';
import { PUBLICATION_STORE, type PublicationStore } from './ports/publication-store.port';

export interface PublicationResult {
  status: 'published';
  publishedAt: Date;
  endDate: string;
  publicationSource: 'courtesy';
}

/**
 * POST …/publication (Publicação por Cortesia RN01 a RN05): só o dono
 * (`publish_site`), com a chave do servidor ligada, de um rascunho com
 * endereço, data e fuso, e a data de saída do ar nos limites. Numa transação,
 * com o Wedding travado: status, publishedAt, endDate, publicationSource e
 * publishedByUserId; o log `wedding.published` e, depois do commit, o evento
 * `publicado`.
 */
@Injectable()
export class PublishWedding {
  constructor(
    private readonly authorization: WeddingAuthorization,
    private readonly config: AppConfigService,
    @Inject(PUBLICATION_STORE) private readonly store: PublicationStore,
    @Inject(APPLICATION_LOG_WRITER) private readonly log: ApplicationLogWriter,
    @Inject(PRODUCT_EVENT_RECORDER) private readonly productEvents: ProductEventRecorder,
    @Inject(AFTER_COMMIT) private readonly afterCommit: AfterCommit,
  ) {}

  async execute({
    userId,
    weddingId,
    endDate,
    ip,
    now,
  }: {
    userId: string;
    weddingId: string;
    endDate: string;
    ip: string | null;
    now: Date;
  }): Promise<PublicationResult> {
    await this.authorization.require({ userId, weddingId, action: 'publish_site' });
    // A chave do front só esconde o botão; quem decide é o servidor (RN01).
    if (!this.config.get({ key: 'COURTESY_PUBLICATION_ENABLED' }))
      throw new CourtesyDisabledError();

    const wedding = await this.store.lock({ weddingId });
    if (!wedding || wedding.status !== 'draft') throw new NotDraftError();
    if (!wedding.slug) throw new SiteSlugMissingError();
    const range = endDateRange({ eventDate: wedding.eventDate, timezone: wedding.timezone });
    if (!range || !wedding.eventDate || !wedding.timezone) throw new EventDateMissingError();
    if (!isEndDateInRange({ endDate, range }))
      throw new EndDateOutOfRangeError({ endDateMin: range.min, endDateMax: range.max });

    await this.store.publishByCourtesy({ weddingId, endDate, userId, now });
    await this.log.record({
      entry: {
        action: 'wedding.published',
        actorKind: 'user',
        actorUserId: userId,
        weddingId,
        entityType: 'wedding',
        entityId: weddingId,
        data: { courtesy: true },
        ...(ip ? { ip } : {}),
      },
    });
    const daysUntilWedding = daysBetween({
      from: localDate({ at: now, timezone: wedding.timezone }),
      to: wedding.eventDate,
    });
    this.afterCommit.schedule(() =>
      this.productEvents.record({
        event: { name: 'publicado', weddingId, props: { dias_ate_casamento: daysUntilWedding } },
        occurredAt: now,
      }),
    );
    return { status: 'published', publishedAt: now, endDate, publicationSource: 'courtesy' };
  }
}
