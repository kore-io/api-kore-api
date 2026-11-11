/**
 * Onde o objeto mora (Imagens do site, RN06): `private` guarda o original do
 * envio e nunca é público; `public` guarda as versões servidas pelo CDN.
 */
export type StorageBucket = 'private' | 'public';

export interface PresignedPut {
  url: string;
  /** Cabeçalhos assinados. O `Content-Length` é informativo no navegador (S4 RN04). */
  headers: { 'Content-Type': string; 'Content-Length': string };
  expiresAt: Date;
}

export interface StoredObjectHead {
  sizeBytes: number;
}

/**
 * Armazenamento compatível com S3: MinIO no local e nos testes, R2 em
 * homologação e produção (ADR do MinIO). O código só usa PUT pré-assinado,
 * HEAD, GET, PUT e DELETE.
 */
export interface ObjectStorage {
  /**
   * URL de PUT presa à chave, ao tipo e ao tamanho, válida por `expiresInSeconds`
   * a partir de `now` (o relógio vem de quem chama, para o teste do prazo).
   */
  presignPut({
    bucket,
    key,
    contentType,
    sizeBytes,
    now,
    expiresInSeconds,
  }: {
    bucket: StorageBucket;
    key: string;
    contentType: string;
    sizeBytes: number;
    now: Date;
    expiresInSeconds: number;
  }): Promise<PresignedPut>;

  /** O tamanho sem ler o corpo; `null` quando o objeto não existe. */
  head({ bucket, key }: { bucket: StorageBucket; key: string }): Promise<StoredObjectHead | null>;

  get({ bucket, key }: { bucket: StorageBucket; key: string }): Promise<Buffer>;

  put({
    bucket,
    key,
    body,
    contentType,
    cacheControl,
  }: {
    bucket: StorageBucket;
    key: string;
    body: Buffer;
    contentType: string;
    cacheControl?: string;
  }): Promise<void>;

  /** Apaga as chaves; chave que não existe não é erro. */
  delete({ bucket, keys }: { bucket: StorageBucket; keys: readonly string[] }): Promise<void>;

  /** Endereço público (CDN) de um objeto do bucket `public`. */
  publicUrl({ key }: { key: string }): string;
}

export const OBJECT_STORAGE = Symbol('ObjectStorage');
