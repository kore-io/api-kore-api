import type { DeliveryStatus } from '../../../guests/domain/party';
import type { StatsDelta } from '../../../guests/domain/wedding-stats';
import type { RsvpGuest, RsvpGuestUpdate } from '../../domain/rsvp';

export interface RsvpPartyRow {
  id: string;
  name: string;
  version: number;
  plusOneSlots: number;
  deliveryStatus: DeliveryStatus;
  firstViewedAt: Date | null;
}

/** Quem grava: o grupo pelo RSVP (com quem assinou) ou o casal pelo Painel (Prazo RN04). */
export type ResponseActorInput =
  { kind: 'party'; signedByGuestId: string } | { kind: 'couple'; userId: string };

/** O que o RSVP lê do casamento (a prévia e o casal leem pela RLS do vínculo; o grupo, pelo contexto). */
export interface RsvpWeddingRow {
  status: string;
  timezone: string | null;
  /** AAAA-MM-DD. */
  eventDate: string | null;
  rsvpDeadline: string | null;
  publishedAt: string | null;
  songQuestionEnabled: boolean;
  songQuestionText: string | null;
  contactWhatsapp: string | null;
  contactEmail: string | null;
}

/**
 * O RSVP na transação corrente: a do grupo (RSVP RN13; papel kore_party) ou,
 * na prévia, a do vínculo (só leitura).
 */
export interface RsvpStore {
  /** Primeiro lock da escrita: os números do casamento (ordem da F1, decisão 217). */
  lockStats({ weddingId }: { weddingId: string }): Promise<void>;
  /** Segundo lock: o grupo, fora da lixeira. */
  lockParty({ partyId }: { partyId: string }): Promise<RsvpPartyRow | null>;
  readParty({ partyId }: { partyId: string }): Promise<RsvpPartyRow | null>;
  /** Os convidados ativos, na ordem do grupo (Grupos RN17): os com nome, depois as vagas. */
  guests({ partyId }: { partyId: string }): Promise<RsvpGuest[]>;
  /** O casamento, pela RLS do vínculo (prévia). */
  wedding({ weddingId }: { weddingId: string }): Promise<RsvpWeddingRow | null>;
  /** Gravações do grupo hoje, no fuso do casamento (o teto da RN10, contado no banco). */
  submissionsToday({
    partyId,
    timezone,
    now,
  }: {
    partyId: string;
    timezone: string | null;
    now: Date;
  }): Promise<number>;
  /** A RsvpSubmission, os convidados que mudaram e uma GuestResponse para cada um. */
  saveSubmission({
    weddingId,
    partyId,
    submissionId,
    actor,
    counts,
    updates,
    now,
  }: {
    weddingId: string;
    partyId: string;
    submissionId: string;
    actor: ResponseActorInput;
    counts: { confirmed: number; declined: number };
    updates: readonly RsvpGuestUpdate[];
    now: Date;
  }): Promise<void>;
  applyStats({ weddingId, delta }: { weddingId: string; delta: StatsDelta }): Promise<void>;
  /** A versão sobe; a última resposta, do grupo ou do casal (Prazo RN07). */
  markResponded({
    partyId,
    deliveryStatus,
    respondedAt,
    actor,
  }: {
    partyId: string;
    deliveryStatus: DeliveryStatus;
    respondedAt: Date | null;
    actor: ResponseActorInput;
  }): Promise<void>;
  /** O grupo ativo do convidado ativo (o Alterar resposta, pela RLS do vínculo). */
  partyOfGuest({ guestId }: { guestId: string }): Promise<string | null>;
  /** Grava o prazo de resposta (Prazo RN01); nulo tira. */
  updateDeadline({
    weddingId,
    rsvpDeadline,
  }: {
    weddingId: string;
    rsvpDeadline: string | null;
  }): Promise<void>;
  /**
   * A notificação pela notify_rsvp (Central RN02 a RN04): os donos e, à parte,
   * a cerimonialista colaboradora (Notificações da cerimonialista RN02).
   */
  notify({
    submissionId,
    notificationIds,
  }: {
    submissionId: string;
    notificationIds: readonly string[];
  }): Promise<{ firstResponse: boolean; recipients: string[]; plannerRecipients: string[] }>;
}

export const RSVP_STORE = Symbol('RsvpStore');
