import type { DeliveryStatus } from '../../../guests/domain/party';
import type { DeliveryChannel } from '../../domain/deliveries';
import type { MessageKind } from '../../domain/message-templates';

/** O que os envios usam do casamento (Envios RN01 e RN06). */
export interface DeliveryWedding {
  status: string;
  timezone: string | null;
  /** AAAA-MM-DD. */
  eventDate: string | null;
  rsvpDeadline: string | null;
  slug: string | null;
}

/** Um grupo da fila (Envios RN07), com o contato inteiro (só a fila o devolve, RN11). */
export interface DeliveryPartyRow {
  id: string;
  name: string;
  linkToken: string;
  deliveryStatus: DeliveryStatus;
  sentAt: Date | null;
  lastChannel: DeliveryChannel | null;
  saveTheDateSentAt: Date | null;
  lastReminderAt: Date | null;
  contact: {
    guestId: string;
    name: string | null;
    phone: string | null;
    email: string | null;
  } | null;
  /** Entra no lembrete: já enviado, com algum convidado com nome pendente (RN03; R4-5). */
  remindable: boolean;
}

/** Envios, na transação da requisição (RLS do vínculo). */
export interface DeliveryStore {
  wedding({ weddingId }: { weddingId: string }): Promise<DeliveryWedding | null>;
  /** Os grupos ativos do casamento entre os pedidos, na ordem da lista (nome sem acento). */
  parties({
    weddingId,
    partyIds,
    lock,
  }: {
    weddingId: string;
    partyIds: readonly string[];
    /** `FOR UPDATE`, na ordem do id (sem deadlock com o mover e a lixeira). */
    lock: boolean;
  }): Promise<DeliveryPartyRow[]>;
  countActiveParties({ weddingId }: { weddingId: string }): Promise<number>;
  /**
   * Marca o envio (RN07 e RN08): no convite, `sentAt` só no 1º, `lastChannel` e
   * `not_sent → sent`; no save the date, `saveTheDateSentAt`; no lembrete,
   * `lastReminderAt`. Uma PartyDelivery por grupo.
   */
  mark({
    weddingId,
    partyIds,
    kind,
    channel,
    userId,
    now,
  }: {
    weddingId: string;
    partyIds: readonly string[];
    kind: MessageKind;
    channel: DeliveryChannel;
    userId: string;
    now: Date;
  }): Promise<void>;
}

export const DELIVERY_STORE = Symbol('DeliveryStore');
