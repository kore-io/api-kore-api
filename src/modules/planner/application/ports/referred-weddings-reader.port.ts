import type { MyWeddingStatus } from '../../domain/my-weddings';

/** Um casal que veio pelo link dela, como a função do banco devolve (RN04). */
export interface ReferredWeddingRow {
  weddingId: string;
  status: MyWeddingStatus;
  createdAt: Date;
  partnerNames: [string, string];
  /** Ela tem vínculo collaborator ativo nele (RN05). */
  clickable: boolean;
}

/**
 * Os casais do link de indicação pela função `referred_weddings()` (Link de
 * indicação RN04): SECURITY DEFINER, sem parâmetro de id, na transação da
 * requisição com o kore_app. Nunca pela conexão do backoffice.
 */
export interface ReferredWeddingsReader {
  list(): Promise<ReferredWeddingRow[]>;
}

export const REFERRED_WEDDINGS_READER = Symbol('ReferredWeddingsReader');
