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

  /**
   * `uploading` → `processing` de forma atômica (S4 RN05): só uma confirmação
   * pega a imagem. Devolve se pegou.
   */
  claimForProcessing({
    weddingId,
    imageId,
  }: {
    weddingId: string;
    imageId: string;
  }): Promise<boolean>;

  find({
    weddingId,
    imageId,
  }: {
    weddingId: string;
    imageId: string;
  }): Promise<SiteImageRow | null>;

  /** `processing` → `ready`, fora de uso desde já (`unusedSince = readyAt`; S4 RN08). */
  markReady({
    imageId,
    sizeBytes,
    width,
    height,
    thumbKey,
    ogKey,
    now,
  }: {
    imageId: string;
    sizeBytes: number;
    width: number;
    height: number;
    thumbKey: string;
    ogKey: string;
    now: Date;
  }): Promise<SiteImageRow | null>;

  /** `processing` → `failed`: a rotina apaga a linha (S4 RN08). */
  markFailed({ imageId }: { imageId: string }): Promise<void>;

  /** `processing` → `uploading`, para o app poder enviar e confirmar de novo. */
  releaseToUploading({ imageId }: { imageId: string }): Promise<void>;
}

export interface SiteImageRow {
  id: string;
  status: SiteImageStatus;
  storageKey: string;
  thumbKey: string | null;
  width: number | null;
  height: number | null;
}

export const SITE_IMAGE_STORE = Symbol('SiteImageStore');
