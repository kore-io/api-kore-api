import type { AgeGroup, RsvpStatus } from '../../domain/party';

export interface TrashedGuestRow {
  id: string;
  partyId: string;
  name: string | null;
  isPlusOne: boolean;
  rsvpStatus: RsvpStatus;
  ageGroup: AgeGroup | null;
  phone: string | null;
  email: string | null;
  trashBatchId: string | null;
  deletedAt: Date;
}

export interface TrashedPartyRow {
  id: string;
  name: string;
  deletedAt: Date;
  /** Os convidados que foram junto com o grupo (o trashBatchId dele). */
  batch: TrashedGuestRow[];
}

export interface TrashedTagRow {
  id: string;
  name: string;
  deletedAt: Date;
  /** Pelos vínculos guardados, com a regra da Tags RN05 (calculado na hora). */
  guests: number;
}

/** Um item da tela Lixeira (RN08). */
export type TrashListRow =
  | { type: 'party'; id: string; name: string; guests: number; deletedAt: Date }
  | { type: 'guest'; id: string; name: string; partyName: string; deletedAt: Date }
  | { type: 'tag'; id: string; name: string; guests: number; deletedAt: Date };

/** A lixeira, na transação da requisição (RLS ligada). */
export interface TrashStore {
  weddingTimezone({ weddingId }: { weddingId: string }): Promise<string | null>;
  /** O grupo e os convidados ativos dele, com o mesmo trashBatchId (RN03). */
  trashParty({
    partyId,
    batchId,
    now,
  }: {
    partyId: string;
    batchId: string;
    now: Date;
  }): Promise<void>;
  trashGuest({ guestId, now }: { guestId: string; now: Date }): Promise<void>;
  /** A tag sai; os vínculos ficam guardados para a restauração (RN05). */
  trashTag({
    weddingId,
    tagId,
    now,
  }: {
    weddingId: string;
    tagId: string;
    now: Date;
  }): Promise<boolean>;
  list({ weddingId }: { weddingId: string }): Promise<TrashListRow[]>;
  findTrashedParty({
    weddingId,
    partyId,
  }: {
    weddingId: string;
    partyId: string;
  }): Promise<TrashedPartyRow | null>;
  findTrashedGuest({
    weddingId,
    guestId,
  }: {
    weddingId: string;
    guestId: string;
  }): Promise<TrashedGuestRow | null>;
  findTrashedTag({
    weddingId,
    tagId,
  }: {
    weddingId: string;
    tagId: string;
  }): Promise<TrashedTagRow | null>;
  /** O nome da tag ativa que conflita com este, sem diferenciar maiúsculas. */
  activeTagNamed({ weddingId, name }: { weddingId: string; name: string }): Promise<string | null>;
  restoreParty({
    partyId,
    guestIds,
  }: {
    partyId: string;
    guestIds: readonly string[];
  }): Promise<void>;
  /** O acompanhante com nome volta como convidado comum (RN09). */
  restoreGuest({ guestId, asRegular }: { guestId: string; asRegular: boolean }): Promise<void>;
  /** 'name_taken' se outra tag ativa pegou o nome no meio (índice único). */
  restoreTag({ tagId }: { tagId: string }): Promise<'restored' | 'name_taken'>;
}

export const TRASH_STORE = Symbol('TrashStore');
