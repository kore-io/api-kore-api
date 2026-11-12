/** O casamento travado para a publicação (Publicação RN05). */
export interface PublicationTarget {
  status: string;
  slug: string | null;
  /** AAAA-MM-DD. */
  eventDate: string | null;
  timezone: string | null;
}

/** Publicação por Cortesia, na transação da requisição (RLS do vínculo). */
export interface PublicationStore {
  /** `SELECT … FOR UPDATE` no Wedding: duas publicações ao mesmo tempo dão uma só. */
  lock({ weddingId }: { weddingId: string }): Promise<PublicationTarget | null>;

  publishByCourtesy({
    weddingId,
    endDate,
    userId,
    now,
  }: {
    weddingId: string;
    endDate: string;
    userId: string;
    now: Date;
  }): Promise<void>;
}

export const PUBLICATION_STORE = Symbol('PublicationStore');
