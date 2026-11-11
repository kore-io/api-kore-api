import type { AgeGroup } from '../../domain/party';
import type { StatsDelta } from '../../domain/wedding-stats';

export interface NewGuest {
  id: string;
  /** Nulo só na vaga de acompanhante. */
  name: string | null;
  ageGroup: AgeGroup | null;
  /** E.164. */
  phone: string | null;
  email: string | null;
  isPlusOne: boolean;
}

export interface NewParty {
  id: string;
  weddingId: string;
  name: string;
  internalNote: string | null;
  linkToken: string;
  contactGuestId: string | null;
  /** Na ordem do grupo (RN17), vagas no fim. */
  guests: readonly NewGuest[];
  tagIds: readonly string[];
  now: Date;
}

/** Escritas do grupo, na transação da requisição (RLS ligada). */
export interface PartyStore {
  /** Dos ids pedidos, os de tags ativas do casamento. */
  findActiveTagIds({
    weddingId,
    tagIds,
  }: {
    weddingId: string;
    tagIds: readonly string[];
  }): Promise<string[]>;
  create({ party }: { party: NewParty }): Promise<void>;
  /** Troca o token e sobe a versão; null se o grupo não está ativo no casamento. */
  regenerateLink({
    weddingId,
    partyId,
    linkToken,
    now,
  }: {
    weddingId: string;
    partyId: string;
    linkToken: string;
    now: Date;
  }): Promise<{ linkToken: string; regeneratedAt: Date } | null>;
  /** Soma o delta nos números do casamento, na mesma transação (RN16). */
  applyStats({ weddingId, delta }: { weddingId: string; delta: StatsDelta }): Promise<void>;
}

export const PARTY_STORE = Symbol('PartyStore');
