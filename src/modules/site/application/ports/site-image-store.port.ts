import type { SiteImageStatus } from '../../domain/site-image';

/** Imagens do site na transação da requisição, com a RLS ligada. */
export interface SiteImageStore {
  /**
   * `SELECT … FOR UPDATE` no Wedding (S4 RN07 e RN08): serializa a contagem do
   * limite e, depois, o recálculo do "em uso" e a rotina de limpeza.
   */
  lockWedding({ weddingId }: { weddingId: string }): Promise<void>;

  countByStatus({
    weddingId,
    statuses,
  }: {
    weddingId: string;
    statuses: readonly SiteImageStatus[];
  }): Promise<number>;

  createUploading({
    id,
    weddingId,
    storageKey,
    sizeBytes,
    uploadedByUserId,
  }: {
    id: string;
    weddingId: string;
    storageKey: string;
    sizeBytes: number;
    uploadedByUserId: string;
  }): Promise<void>;
}

export const SITE_IMAGE_STORE = Symbol('SiteImageStore');
