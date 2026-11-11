import { Inject, Injectable } from '@nestjs/common';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import {
  PRODUCT_EVENT_RECORDER,
  type ProductEventRecorder,
} from '../../product-events/application/ports/product-event-recorder.port';
import { AFTER_COMMIT, type AfterCommit } from '../../../shared/database/after-commit.port';
import { uuidV7 } from '../../../shared/ids/uuid-v7';
import {
  NothingToImportError,
  SpreadsheetRefusedError,
  TagNameTakenError,
} from '../domain/guests.errors';
import {
  checkSpreadsheet,
  matchesTemplate,
  type ImportWarning,
  type SkippedRow,
  type SpreadsheetCheck,
} from '../domain/spreadsheet-import';
import { guestsDelta } from '../domain/wedding-stats';
import { PARTY_LINKS, type PartyLinks } from './ports/party-links.port';
import { PARTY_STORE, type NewParty, type PartyStore } from './ports/party-store.port';
import { SPREADSHEET_READER, type SpreadsheetReader } from './ports/spreadsheet-reader.port';
import { TAG_STORE, type TagStore } from './ports/tag-store.port';

/** Nome da tag comparável, como a checagem da planilha (RN08). */
const tagKey = (name: string) => name.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * O que as duas rotas da planilha têm em comum: ler (yauzl + exceljs), conferir
 * os títulos do modelo e validar as linhas contra os grupos e as tags ativos
 * (Importação RN03 a RN08). Nada vai para o log (186(6)).
 */
@Injectable()
export class SpreadsheetCheckService {
  constructor(
    @Inject(SPREADSHEET_READER) private readonly reader: SpreadsheetReader,
    @Inject(PARTY_STORE) private readonly parties: PartyStore,
    @Inject(TAG_STORE) private readonly tags: TagStore,
  ) {}

  async check({ weddingId, file }: { weddingId: string; file: Buffer }): Promise<SpreadsheetCheck> {
    const sheet = await this.reader.read({ file });
    if (!matchesTemplate({ header: sheet.header }))
      throw new SpreadsheetRefusedError({ code: 'TEMPLATE_MISMATCH' });
    const result = checkSpreadsheet({
      rows: sheet.rows,
      firstRow: 2,
      activePartyNames: await this.parties.activePartyNames({ weddingId }),
      activeTagNames: (await this.tags.listActive({ weddingId })).map((tag) => tag.name),
    });
    if (typeof result === 'string') throw new SpreadsheetRefusedError({ code: result });
    return result;
  }
}

export interface SpreadsheetPreview {
  fileName: string;
  parties: number;
  guests: number;
  counts: SpreadsheetCheck['counts'];
  skipped: SkippedRow[];
  warnings: ImportWarning[];
}

/** Prévia da planilha (Importação RN09): sem gravar nada e sem guardar o arquivo. */
@Injectable()
export class PreviewSpreadsheet {
  constructor(
    private readonly authorization: WeddingAuthorization,
    private readonly checker: SpreadsheetCheckService,
  ) {}

  async execute({
    userId,
    weddingId,
    file,
    fileName,
  }: {
    userId: string;
    weddingId: string;
    file: Buffer;
    fileName: string;
  }): Promise<SpreadsheetPreview> {
    await this.authorization.require({ userId, weddingId, action: 'manage_guests' });
    const result = await this.checker.check({ weddingId, file });
    return {
      fileName,
      parties: result.parties.length,
      guests: result.counts.valid,
      counts: result.counts,
      skipped: result.skipped,
      warnings: result.warnings,
    };
  }
}

/**
 * Importar a planilha (Importação RN01, RN04 a RN09 e RN14): o mesmo arquivo,
 * validado de novo; só as linhas válidas entram, numa transação: as tags novas
 * até 10 (com o lock das tags do casamento), grupos novos com o contato,
 * convidados pendentes com as tags deles, os números do casamento e, depois do
 * commit, o evento importacao{metodo: planilha}.
 */
@Injectable()
export class ImportSpreadsheet {
  constructor(
    private readonly authorization: WeddingAuthorization,
    private readonly checker: SpreadsheetCheckService,
    @Inject(PARTY_STORE) private readonly parties: PartyStore,
    @Inject(TAG_STORE) private readonly tags: TagStore,
    @Inject(PARTY_LINKS) private readonly links: PartyLinks,
    @Inject(PRODUCT_EVENT_RECORDER) private readonly productEvents: ProductEventRecorder,
    @Inject(AFTER_COMMIT) private readonly afterCommit: AfterCommit,
  ) {}

  async execute({
    userId,
    weddingId,
    file,
    now,
  }: {
    userId: string;
    weddingId: string;
    file: Buffer;
    now: Date;
  }): Promise<{ parties: number; guests: number; skipped: number; tagsCreated: string[] }> {
    await this.authorization.require({ userId, weddingId, action: 'manage_guests' });
    await this.parties.lockStats({ weddingId });
    await this.tags.lockWeddingTags({ weddingId });
    const result = await this.checker.check({ weddingId, file });
    if (result.counts.valid === 0) throw new NothingToImportError();

    const tagIds = new Map(
      (await this.tags.listActive({ weddingId })).map((tag) => [tagKey(tag.name), tag.id]),
    );
    for (const name of result.tagsToCreate) {
      const id = uuidV7();
      // O lock das tags vale para quem cria pela tela; o índice é a última barreira.
      if ((await this.tags.create({ id, weddingId, name, color: null })) === 'name_taken')
        throw new TagNameTakenError();
      tagIds.set(tagKey(name), id);
    }

    let tick = now.getTime();
    const parties: NewParty[] = result.parties.map((party) => {
      const partyId = uuidV7({ now: tick++ });
      const guests = party.guests.map((guest) => ({
        id: uuidV7({ now: tick++ }),
        name: guest.name,
        ageGroup: guest.ageGroup,
        phone: guest.phone,
        email: guest.email,
        isPlusOne: false,
        dietaryRestriction: guest.dietaryRestriction,
        tagIds: [...new Set(guest.tags.map((tag) => tagIds.get(tagKey(tag)) as string))],
      }));
      return {
        id: partyId,
        weddingId,
        name: party.name,
        internalNote: null,
        linkToken: this.links.newToken(),
        contactGuestId: party.contactIndex === null ? null : guests[party.contactIndex].id,
        guests,
        tagIds: [],
        now,
      };
    });
    await this.parties.createMany({ parties });

    const guests = result.counts.valid;
    await this.parties.applyStats({
      weddingId,
      delta: {
        ...guestsDelta({
          guests: Array.from({ length: guests }, () => ({
            rsvpStatus: 'pending' as const,
            ageGroup: null,
          })),
          sign: 1,
        }),
        partiesPending: parties.length,
      },
    });
    const skipped = result.counts.errors + result.counts.duplicates;
    this.afterCommit.schedule(() =>
      this.productEvents.record({
        event: {
          name: 'importacao',
          weddingId,
          props: { metodo: 'planilha', linhas_erro: skipped },
        },
        occurredAt: now,
      }),
    );
    return { parties: parties.length, guests, skipped, tagsCreated: result.tagsToCreate };
  }
}
