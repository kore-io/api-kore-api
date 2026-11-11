import type { TagColor } from '../../domain/party';

export interface TagRow {
  id: string;
  name: string;
  color: TagColor | null;
  /** Convidados ativos com a tag ou num grupo com a tag, cada um uma vez, sem vagas vazias (RN05). */
  guests: number;
}

/** Tags do casamento, na transação da requisição (RLS ligada). */
export interface TagStore {
  /** Trava a criação de tags do casamento até o fim da transação (RN01: o limite na transação). */
  lockWeddingTags({ weddingId }: { weddingId: string }): Promise<void>;
  countActive({ weddingId }: { weddingId: string }): Promise<number>;
  /** As tags ativas, em ordem de nome (sem acento), com a contagem. */
  listActive({ weddingId }: { weddingId: string }): Promise<TagRow[]>;
  findActive({ weddingId, tagId }: { weddingId: string; tagId: string }): Promise<TagRow | null>;
  /** 'name_taken' quando outra tag ativa tem o nome (índice único parcial). */
  create({
    id,
    weddingId,
    name,
    color,
  }: {
    id: string;
    weddingId: string;
    name: string;
    color: TagColor | null;
  }): Promise<'created' | 'name_taken'>;
  update({
    weddingId,
    tagId,
    name,
    color,
  }: {
    weddingId: string;
    tagId: string;
    name?: string;
    color?: TagColor | null;
  }): Promise<'updated' | 'not_found' | 'name_taken'>;
  /** Dos ids pedidos, os de grupos ativos do casamento. */
  findActivePartyIds({
    weddingId,
    partyIds,
  }: {
    weddingId: string;
    partyIds: readonly string[];
  }): Promise<string[]>;
  /** Liga a tag aos grupos; quem já tinha fica como está. */
  applyToParties({
    weddingId,
    tagId,
    partyIds,
  }: {
    weddingId: string;
    tagId: string;
    partyIds: readonly string[];
  }): Promise<void>;
}

export const TAG_STORE = Symbol('TagStore');
