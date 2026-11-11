import type { AgeGroup, DeliveryStatus, RsvpStatus, TagColor } from '../../domain/party';

export interface TagSummary {
  id: string;
  name: string;
  color: TagColor | null;
}

export interface PartyGuestRow {
  id: string;
  name: string | null;
  ageGroup: AgeGroup | null;
  dietaryRestriction: string | null;
  phone: string | null;
  email: string | null;
  isPlusOne: boolean;
  rsvpStatus: RsvpStatus;
  tags: TagSummary[];
}

/** O grupo para o Painel e o Editar grupo (RN14). */
export interface PartyDetailsRow {
  id: string;
  name: string;
  contactGuestId: string | null;
  plusOneSlots: number;
  internalNote: string | null;
  linkToken: string;
  linkRegeneratedAt: Date | null;
  deliveryStatus: DeliveryStatus;
  weddingSlug: string | null;
  tags: TagSummary[];
  /** Na ordem do grupo (RN17): com nome por joinedPartyAt e id, vagas no fim. */
  guests: PartyGuestRow[];
}

export interface PartyListQuery {
  weddingId: string;
  /** Já normalizado pela busca (minúsculas, sem acento é no banco). */
  q?: string;
  rsvp?: RsvpStatus;
  sent?: DeliveryStatus;
  tagId?: string;
  /** Depois deste (nome normalizado, id), na ordem da lista. */
  after?: { name: string; id: string };
  limit: number;
}

export interface PartyListRow {
  id: string;
  name: string;
  /** lower(f_unaccent(name)), a chave do cursor. */
  sortName: string;
  contact: { guestId: string; name: string | null; phone: string | null } | null;
  firstGuestName: string | null;
  people: number;
  counts: { confirmed: number; declined: number; pending: number; pendingPlusOnes: number };
  deliveryStatus: DeliveryStatus;
  respondedAt: Date | null;
  tags: TagSummary[];
}

export interface PartySummaryRow {
  guests: number;
  namedGuests: number;
  parties: number;
  confirmed: number;
  declined: number;
  pending: number;
}

/** Leituras do grupo, na transação da requisição (RLS ligada). */
export interface PartyReader {
  findActive({
    weddingId,
    partyId,
  }: {
    weddingId: string;
    partyId: string;
  }): Promise<PartyDetailsRow | null>;
  weddingSlug({ weddingId }: { weddingId: string }): Promise<string | null>;
  isActiveTag({ weddingId, tagId }: { weddingId: string; tagId: string }): Promise<boolean>;
  list({ query }: { query: PartyListQuery }): Promise<{ rows: PartyListRow[]; total: number }>;
  summary({ weddingId }: { weddingId: string }): Promise<PartySummaryRow>;
}

export const PARTY_READER = Symbol('PartyReader');
