export interface SiteImageCleanupCounts {
  /** `uploading` ou `processing` há mais de 1 hora. */
  stale: number;
  failed: number;
  /** `ready` fora de uso há mais de 24 horas. */
  unused: number;
}

/** Limpeza das imagens do site pela conexão do backoffice (S4 RN08). */
export interface SiteImageCleanup {
  /** Casamentos com alguma imagem a apagar (lido sem lock; cada um é reconferido). */
  weddingsWithCandidates({ now }: { now: Date }): Promise<string[]>;

  /**
   * Numa transação, com `FOR UPDATE` no Wedding: reconfere as condições, apaga
   * as linhas e os arquivos das imagens do casamento que passaram do prazo.
   */
  cleanWedding({
    weddingId,
    now,
  }: {
    weddingId: string;
    now: Date;
  }): Promise<SiteImageCleanupCounts>;
}

export const SITE_IMAGE_CLEANUP = Symbol('SiteImageCleanup');
