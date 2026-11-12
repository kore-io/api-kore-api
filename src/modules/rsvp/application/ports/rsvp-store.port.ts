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

/** O que o RSVP lê do casamento (a prévia lê pela RLS do vínculo; o grupo, pelo contexto). */
export interface RsvpWeddingRow {
  status: string;
  timezone: string | null;
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
    signedByGuestId,
    counts,
    updates,
    now,
  }: {
    weddingId: string;
    partyId: string;
    submissionId: string;
    signedByGuestId: string;
    counts: { confirmed: number; declined: number };
    updates: readonly RsvpGuestUpdate[];
    now: Date;
  }): Promise<void>;
  applyStats({ weddingId, delta }: { weddingId: string; delta: StatsDelta }): Promise<void>;
  /** A versão sobe; a última resposta é do grupo (Prazo RN07). */
  markResponded({
    partyId,
    deliveryStatus,
    respondedAt,
    signedByGuestId,
  }: {
    partyId: string;
    deliveryStatus: DeliveryStatus;
    respondedAt: Date | null;
    signedByGuestId: string;
  }): Promise<void>;
  /** A notificação dos donos pela notify_rsvp (Central RN02 a RN04). */
  notify({
    submissionId,
    notificationIds,
  }: {
    submissionId: string;
    notificationIds: readonly string[];
  }): Promise<{ firstResponse: boolean; recipients: string[] }>;
}

export const RSVP_STORE = Symbol('RsvpStore');
