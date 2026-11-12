import type { RsvpStatus } from '../../guests/domain/party';
import { DEFAULT_SONG_QUESTION, type RsvpGuest, type RsvpState } from '../domain/rsvp';
import type { RsvpPartyRow, RsvpWeddingRow } from './ports/rsvp-store.port';

/** O formulário do grupo (GET e PUT /v1/sites/{slug}/rsvp; RSVP RN03 e RN08). */
export interface RsvpView {
  party: { id: string; name: string; version: number };
  guests: {
    id: string;
    name: string | null;
    isPlusOne: boolean;
    rsvpStatus: RsvpStatus;
    dietaryRestriction: string | null;
    songSuggestion: string | null;
  }[];
  plusOneSlots: number;
  /** AAAA-MM-DD; nulo sem prazo. */
  rsvpDeadline: string | null;
  state: RsvpState | 'preview';
  songQuestion: { enabled: boolean; text: string };
  /** O contato do casal, para "WhatsApp do casal: {número}" depois do prazo (RN08). */
  contact: { whatsapp: string | null; email: string | null };
}

export function rsvpView({
  party,
  guests,
  wedding,
  state,
}: {
  party: RsvpPartyRow;
  guests: readonly RsvpGuest[];
  wedding: Omit<RsvpWeddingRow, 'status' | 'timezone' | 'publishedAt'>;
  state: RsvpView['state'];
}): RsvpView {
  return {
    party: { id: party.id, name: party.name, version: party.version },
    guests: guests.map((guest) => ({
      id: guest.id,
      name: guest.name,
      isPlusOne: guest.isPlusOne,
      rsvpStatus: guest.rsvpStatus,
      dietaryRestriction: guest.dietaryRestriction,
      songSuggestion: guest.songSuggestion,
    })),
    plusOneSlots: party.plusOneSlots,
    rsvpDeadline: wedding.rsvpDeadline,
    state,
    songQuestion: {
      enabled: wedding.songQuestionEnabled,
      text: wedding.songQuestionText ?? DEFAULT_SONG_QUESTION,
    },
    contact: { whatsapp: wedding.contactWhatsapp, email: wedding.contactEmail },
  };
}
