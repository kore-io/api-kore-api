import { Inject, Injectable } from '@nestjs/common';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import {
  APPLICATION_LOG_WRITER,
  type ApplicationLogWriter,
} from '../../logs/application/ports/application-log-writer.port';
import {
  PRODUCT_EVENT_RECORDER,
  type ProductEventRecorder,
} from '../../product-events/application/ports/product-event-recorder.port';
import { AFTER_COMMIT, type AfterCommit } from '../../../shared/database/after-commit.port';
import {
  exportFileName,
  orderedColumns,
  type ExportColumn,
  type ExportFormat,
  type ExportWho,
} from '../domain/export';
import { WeddingNotFoundError } from '../../access/domain/access.errors';
import { GuestFieldsInvalidError, NothingToExportError } from '../domain/guests.errors';
import {
  EXPORT_READER,
  EXPORT_RENDERER,
  type ExportReader,
  type ExportRenderer,
} from './ports/export-reader.port';

export interface ExportedFile {
  fileName: string;
  contentType: string;
  content: Buffer;
}

const CONTENT_TYPES: Record<ExportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

/**
 * Exportar (Exportação RN01 a RN09): o arquivo na hora, com o filtro e as
 * colunas escolhidos. É leitura: qualquer vínculo (export_guests) e vale no
 * casamento bloqueado (RN07). Grava guests.exported no log, sem a lista nem
 * dado pessoal (RN08), e, com a coluna Restrição alimentar, o evento
 * exportacao_buffet depois do commit.
 */
@Injectable()
export class ExportGuests {
  constructor(
    private readonly authorization: WeddingAuthorization,
    @Inject(EXPORT_READER) private readonly reader: ExportReader,
    @Inject(EXPORT_RENDERER) private readonly renderer: ExportRenderer,
    @Inject(APPLICATION_LOG_WRITER) private readonly log: ApplicationLogWriter,
    @Inject(PRODUCT_EVENT_RECORDER) private readonly productEvents: ProductEventRecorder,
    @Inject(AFTER_COMMIT) private readonly afterCommit: AfterCommit,
  ) {}

  async execute({
    userId,
    weddingId,
    format,
    who,
    tagId,
    columns: requested,
    ip,
    now,
  }: {
    userId: string;
    weddingId: string;
    format: ExportFormat;
    who: ExportWho;
    tagId?: string;
    columns: readonly ExportColumn[];
    ip: string | null;
    now: Date;
  }): Promise<ExportedFile> {
    const role = await this.authorization.require({ userId, weddingId, action: 'export_guests' });
    if (who === 'tag' && !(tagId && (await this.reader.isActiveTag({ weddingId, tagId }))))
      throw new GuestFieldsInvalidError({
        issues: [{ path: 'tag', code: tagId ? 'TAG_NOT_FOUND' : 'IS_NOT_EMPTY', params: {} }],
      });
    const wedding = await this.reader.wedding({ weddingId });
    // Sem endereço só a lápide do expurgo, que não tem lista.
    if (!wedding) throw new WeddingNotFoundError();

    const guests = await this.reader.guests({ weddingId, who, tagId });
    if (guests.length === 0) throw new NothingToExportError();
    const columns = orderedColumns({ columns: requested });
    const content = await this.renderer.xlsx({ guests, columns });

    await this.log.record({
      entry: {
        action: 'guests.exported',
        actorKind: 'user',
        actorUserId: userId,
        weddingId,
        entityType: 'wedding',
        entityId: weddingId,
        // O filtro por tag vai pelo id (186(6)); nada da lista.
        data: { format, who, ...(tagId ? { tagId } : {}), columns, guests: guests.length },
        ...(ip ? { ip } : {}),
      },
    });
    if (columns.includes('dietaryRestriction'))
      this.afterCommit.schedule(() =>
        this.productEvents.record({
          event: {
            name: 'exportacao_buffet',
            weddingId,
            props: { formato: format, quem: role, filtro: who },
          },
          occurredAt: now,
        }),
      );

    return {
      fileName: exportFileName({ slug: wedding.slug, timezone: wedding.timezone, now, format }),
      contentType: CONTENT_TYPES[format],
      content,
    };
  }
}
