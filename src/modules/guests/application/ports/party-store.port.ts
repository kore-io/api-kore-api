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
  /** Só a importação pela planilha traz (Importação RN05 e RN08). */
  dietaryRestriction?: string | null;
  tagIds?: readonly string[];
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
  /** Vários grupos de uma vez (a importação), em lotes; tudo na mesma transação. */
  createMany({ parties }: { parties: readonly NewParty[] }): Promise<void>;
  /** Os nomes dos grupos ativos do casamento (o aviso PARTY_NAME_EXISTS). */
  activePartyNames({ weddingId }: { weddingId: string }): Promise<string[]>;
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
  /**
   * Trava a linha dos números do casamento antes de mexer nos convidados, para
   * o recálculo noturno não contar no meio de uma escrita (RN16).
   */
  lockStats({ weddingId }: { weddingId: string }): Promise<void>;
  /** Soma o delta nos números do casamento, na mesma transação (RN16). */
  applyStats({ weddingId, delta }: { weddingId: string; delta: StatsDelta }): Promise<void>;
}

export const PARTY_STORE = Symbol('PartyStore');
