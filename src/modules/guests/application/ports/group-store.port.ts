import type { AgeGroup, DeliveryStatus } from '../../domain/party';
import type { GroupMember } from '../../domain/party-rules';
import type { NewGuest } from './party-store.port';

export interface GroupMemberRow extends GroupMember {
  partyId: string;
  ageGroup: AgeGroup | null;
  tagIds: string[];
}

/** O grupo ativo, com os convidados ativos na ordem do grupo (RN17). */
export interface GroupRow {
  id: string;
  name: string;
  internalNote: string | null;
  contactGuestId: string | null;
  plusOneSlots: number;
  deliveryStatus: DeliveryStatus;
  firstViewedAt: Date | null;
  members: GroupMemberRow[];
}

export interface PartyChanges {
  name?: string;
  internalNote?: string | null;
  contactGuestId?: string | null;
  plusOneSlots?: number;
  deliveryStatus?: DeliveryStatus;
  /**
   * Sobe a Party.version (decisão 216, D11; RSVP RN11): o formulário de RSVP
   * aberto antes da mudança recebe 409 RSVP_CHANGED.
   */
  bumpVersion?: true;
}

export interface GuestChanges {
  name?: string;
  ageGroup?: AgeGroup | null;
  phone?: string | null;
  email?: string | null;
  partyId?: string;
  isPlusOne?: boolean;
  joinedPartyAt?: Date;
}

/** Editar e mover (RN07 a RN10), na transação da requisição (RLS ligada). */
export interface GroupStore {
  /** Trava os grupos (na ordem do id, sem deadlock) até o fim da transação. */
  lock({ weddingId, partyIds }: { weddingId: string; partyIds: readonly string[] }): Promise<void>;
  load({ weddingId, partyId }: { weddingId: string; partyId: string }): Promise<GroupRow | null>;
  findGuest({
    weddingId,
    guestId,
  }: {
    weddingId: string;
    guestId: string;
  }): Promise<GroupMemberRow | null>;
  updateParty({ partyId, changes }: { partyId: string; changes: PartyChanges }): Promise<void>;
  updateGuest({ guestId, changes }: { guestId: string; changes: GuestChanges }): Promise<void>;
  addGuests({
    weddingId,
    partyId,
    guests,
    now,
  }: {
    weddingId: string;
    partyId: string;
    guests: readonly NewGuest[];
    now: Date;
  }): Promise<void>;
  /** Apaga de vez vagas vazias pendentes (RN07). */
  deleteEmptySlots({ guestIds }: { guestIds: readonly string[] }): Promise<void>;
  replacePartyTags({
    weddingId,
    partyId,
    tagIds,
  }: {
    weddingId: string;
    partyId: string;
    tagIds: readonly string[];
  }): Promise<void>;
  replaceGuestTags({
    weddingId,
    guestId,
    tagIds,
  }: {
    weddingId: string;
    guestId: string;
    tagIds: readonly string[];
  }): Promise<void>;
}

export const GROUP_STORE = Symbol('GroupStore');
