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

/**
 * Uma linha do histórico do grupo (Prazo RN05): os envios (PartyDelivery), a
 * primeira visualização e cada gravação de resposta (RsvpSubmission), sem
 * restrição alimentar.
 */
export type PartyHistoryEntry =
  | {
      kind: 'sent' | 'save_the_date' | 'reminder';
      at: Date;
      channel: 'whatsapp' | 'email' | 'link' | 'qr';
    }
  | { kind: 'viewed'; at: Date }
  | {
      kind: 'response';
      at: Date;
      actor: 'party' | 'couple';
      /** Quem assinou pelo grupo; nulo sem assinante ("Respondido pelo grupo"). */
      signedBy: string | null;
      /** Quem alterou pelo casal (dono ou cerimonialista). */
      actorName: string | null;
      /** Os totais do grupo depois da gravação. */
      confirmed: number;
      declined: number;
      /** Na alteração do casal: o convidado e a resposta ("Pedro Moreira não vai"). */
      guest: { name: string | null; status: RsvpStatus } | null;
    };

/** O grupo para o Painel e o Editar grupo (RN14). */
export interface PartyDetailsRow {
  id: string;
  name: string;
  /** A versão do grupo, para o Alterar resposta (Prazo RN04; R3-7). */
  version: number;
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
  /** As 50 linhas mais recentes, da mais nova para a mais antiga (Prazo RN05). */
  history: PartyHistoryEntry[];
}

export interface PartyListQuery {
  weddingId: string;
  /** Já normalizado pela busca (minúsculas, sem acento é no banco). */
  q?: string;
  rsvp?: RsvpStatus;
  sent?: DeliveryStatus;
  tagId?: string;
  /**
   * A fila do lembrete (Envios RN04; Prazo RN02, T5): grupos já enviados com
   * algum convidado com nome pendente; a vaga não conta.
   */
  remind?: boolean;
  /** O filtro do save the date (Envios RN03): enviado ou não. */
  saveTheDate?: 'sent' | 'not_sent';
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
  /** A última resposta (Prazo RN07): do grupo, com quem assinou, ou do casal, com quem alterou. */
  lastResponse: {
    actor: 'party' | 'couple';
    signedByName: string | null;
    actorName: string | null;
  } | null;
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
