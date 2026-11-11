/** Os tokens da prévia saem depois de 1 dia, pela conexão do backoffice (Pré-visualização, modelo). */
export interface SitePreviewTokenCleanup {
  /** Apaga os tokens criados antes de `before`; devolve quantos. */
  deleteCreatedBefore({ before }: { before: Date }): Promise<number>;
}

export const SITE_PREVIEW_TOKEN_CLEANUP = Symbol('SitePreviewTokenCleanup');
