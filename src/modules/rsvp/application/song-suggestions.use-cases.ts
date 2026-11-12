import { Inject, Injectable } from '@nestjs/common';
import { DEFAULT_TIMEZONE } from '../../../shared/time/local-date';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import {
  NoSongsToExportError,
  SongCursorInvalidError,
  SongQuestionDisabledError,
} from '../domain/rsvp.errors';
import {
  SONG_SUGGESTIONS_FILE,
  type SongSuggestionsFile,
  SONG_SUGGESTION_READER,
  type SongSuggestionReader,
  type SongSuggestionRow,
  type SongWedding,
} from './ports/song-suggestion-reader.port';

/** 50 sugestões por página (Música RN05). */
const PAGE_SIZE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function encodeCursor({ row }: { row: SongSuggestionRow }): string {
  return Buffer.from(`${row.suggestedAt.toISOString()}|${row.guestId}`).toString('base64url');
}

function decodeCursor({ cursor }: { cursor: string }): { suggestedAt: Date; guestId: string } {
  const [at, guestId] = Buffer.from(cursor, 'base64url').toString().split('|');
  const suggestedAt = new Date(at ?? '');
  if (Number.isNaN(suggestedAt.getTime()) || !UUID.test(guestId ?? ''))
    throw new SongCursorInvalidError();
  return { suggestedAt, guestId };
}

/** Quem vê (`manage_guests`, qualquer vínculo) e se a pergunta está ligada (Música RN03 e RN05). */
@Injectable()
export class SongSuggestionsAccess {
  constructor(
    private readonly authorization: WeddingAuthorization,
    @Inject(SONG_SUGGESTION_READER) private readonly reader: SongSuggestionReader,
  ) {}

  async open({ userId, weddingId }: { userId: string; weddingId: string }): Promise<SongWedding> {
    await this.authorization.require({ userId, weddingId, action: 'manage_guests' });
    const wedding = await this.reader.wedding({ weddingId });
    if (!wedding) throw new Error('Casamento sem leitura na transação do vínculo.');
    // Desligada, a página leva ao Editor (RN03); as sugestões ficam guardadas (RN02).
    if (!wedding.songQuestionEnabled) throw new SongQuestionDisabledError();
    return wedding;
  }
}

/** GET …/song-suggestions?cursor= (Música RN05): 50 por vez, da mais antiga para a mais nova. */
@Injectable()
export class ListSongSuggestions {
  constructor(
    private readonly access: SongSuggestionsAccess,
    @Inject(SONG_SUGGESTION_READER) private readonly reader: SongSuggestionReader,
  ) {}

  async execute({
    userId,
    weddingId,
    cursor,
  }: {
    userId: string;
    weddingId: string;
    cursor?: string;
  }): Promise<{ items: SongSuggestionRow[]; total: number; nextCursor: string | null }> {
    await this.access.open({ userId, weddingId });
    const after = cursor === undefined ? null : decodeCursor({ cursor });
    const rows = await this.reader.list({ weddingId, after, limit: PAGE_SIZE + 1 });
    const items = rows.slice(0, PAGE_SIZE);
    return {
      items,
      total: await this.reader.count({ weddingId }),
      nextCursor: rows.length > PAGE_SIZE ? encodeCursor({ row: items[items.length - 1] }) : null,
    };
  }
}

/**
 * GET …/song-suggestions/export (Música RN06): o .xlsx para o DJ, na mesma
 * ordem da lista. Sem sugestões, 409 NOTHING_TO_EXPORT. Não gera evento.
 */
@Injectable()
export class ExportSongSuggestions {
  constructor(
    private readonly access: SongSuggestionsAccess,
    @Inject(SONG_SUGGESTION_READER) private readonly reader: SongSuggestionReader,
    @Inject(SONG_SUGGESTIONS_FILE) private readonly xlsx: SongSuggestionsFile,
  ) {}

  async execute({
    userId,
    weddingId,
  }: {
    userId: string;
    weddingId: string;
  }): Promise<{ fileName: string; content: Buffer }> {
    const wedding = await this.access.open({ userId, weddingId });
    const rows = await this.reader.list({ weddingId, after: null, limit: null });
    if (rows.length === 0) throw new NoSongsToExportError();
    return {
      // No padrão da Exportação RN09: musicas-ana-e-marcos.xlsx.
      fileName: `musicas-${wedding.slug ?? 'casamento'}.xlsx`,
      content: await this.xlsx.render({ rows, timezone: wedding.timezone ?? DEFAULT_TIMEZONE }),
    };
  }
}
