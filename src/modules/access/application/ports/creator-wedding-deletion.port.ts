/** O resultado da exclusão, conferido sob o lock do casamento (Meus casamentos RN11). */
export type CreatorWeddingDeletion =
  | { result: 'deleted'; status: string; imageIds: string[] }
  | { result: 'has_owner' }
  | { result: 'not_allowed' };

/**
 * Excluir este casamento pela cerimonialista que o criou (Meus casamentos
 * RN11; revisão C2-5): o kore_app não tem DELETE nas tabelas do casamento,
 * então a exclusão roda numa transação do backoffice, que trava o Wedding
 * (FOR UPDATE, a mesma trava do aceite) e reconfere as quatro condições.
 */
export interface CreatorWeddingDeleter {
  deleteByCreator({
    weddingId,
    userId,
    now,
  }: {
    weddingId: string;
    userId: string;
    now: Date;
  }): Promise<CreatorWeddingDeletion>;
  /** Os arquivos das imagens do site, depois do commit. */
  deleteImageObjects({ imageIds }: { imageIds: readonly string[] }): Promise<void>;
}

export const CREATOR_WEDDING_DELETER = Symbol('CreatorWeddingDeleter');
