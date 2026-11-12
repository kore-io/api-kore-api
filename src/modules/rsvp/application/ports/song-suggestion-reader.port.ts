/** Uma sugestão de música (Música RN05): como o convidado escreveu, com quem e quando. */
export interface SongSuggestionRow {
  guestId: string;
  song: string;
  guestName: string | null;
  partyName: string;
  suggestedAt: Date;
}

export interface SongWedding {
  songQuestionEnabled: boolean;
  slug: string | null;
  timezone: string | null;
}

/** As sugestões, na transação da requisição (RLS do vínculo). */
export interface SongSuggestionReader {
  wedding({ weddingId }: { weddingId: string }): Promise<SongWedding | null>;
  /**
   * Da mais antiga para a mais nova, sem juntar repetidas; só de confirmados,
   * fora da lixeira (o convidado e o grupo). `after` é o cursor (hora e id).
   */
  list({
    weddingId,
    after,
    limit,
  }: {
    weddingId: string;
    after: { suggestedAt: Date; guestId: string } | null;
    limit: number | null;
  }): Promise<SongSuggestionRow[]>;
  count({ weddingId }: { weddingId: string }): Promise<number>;
}

export const SONG_SUGGESTION_READER = Symbol('SongSuggestionReader');

/** O arquivo para o DJ (Música RN06). */
export interface SongSuggestionsFile {
  render({
    rows,
    timezone,
  }: {
    rows: readonly SongSuggestionRow[];
    timezone: string;
  }): Promise<Buffer>;
}

export const SONG_SUGGESTIONS_FILE = Symbol('SongSuggestionsFile');
