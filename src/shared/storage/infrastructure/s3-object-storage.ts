import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import type {
  ObjectStorage,
  PresignedPut,
  StorageBucket,
  StoredObjectHead,
} from '../application/object-storage.port';

// O DeleteObjects aceita até 1.000 chaves por chamada.
const DELETE_BATCH = 1000;

/** Adaptador S3: MinIO no local (path-style) e R2 em homologação e produção. */
@Injectable()
export class S3ObjectStorage implements ObjectStorage, OnModuleDestroy {
  private readonly client: S3Client;
  private readonly buckets: Record<StorageBucket, string>;
  private readonly publicBaseUrl: string;

  constructor(config: AppConfigService) {
    this.client = new S3Client({
      endpoint: config.get({ key: 'STORAGE_ENDPOINT' }),
      region: config.get({ key: 'STORAGE_REGION' }),
      forcePathStyle: config.get({ key: 'STORAGE_FORCE_PATH_STYLE' }),
      credentials: {
        accessKeyId: config.get({ key: 'STORAGE_ACCESS_KEY_ID' }),
        secretAccessKey: config.get({ key: 'STORAGE_SECRET_ACCESS_KEY' }),
      },
      // Sem o checksum automático do SDK: a URL pré-assinada exigiria do
      // navegador um cabeçalho de checksum que ele não sabe calcular, e o R2
      // não aceita todos os algoritmos novos.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
    this.buckets = {
      private: config.get({ key: 'STORAGE_PRIVATE_BUCKET' }),
      public: config.get({ key: 'STORAGE_PUBLIC_BUCKET' }),
    };
    this.publicBaseUrl = config.get({ key: 'STORAGE_PUBLIC_URL' }).replace(/\/+$/, '');
  }

  async presignPut({
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
  }): Promise<PresignedPut> {
    const command = new PutObjectCommand({
      Bucket: this.buckets[bucket],
      Key: key,
      ContentType: contentType,
      ContentLength: sizeBytes,
    });
    // Tipo e tamanho entram na assinatura: outro arquivo com a mesma URL é recusado.
    const url = await getSignedUrl(this.client, command, {
      expiresIn: expiresInSeconds,
      signingDate: now,
      signableHeaders: new Set(['content-type', 'content-length']),
    });
    return {
      url,
      headers: { 'Content-Type': contentType, 'Content-Length': String(sizeBytes) },
      expiresAt: new Date(now.getTime() + expiresInSeconds * 1000),
    };
  }

  async head({
    bucket,
    key,
  }: {
    bucket: StorageBucket;
    key: string;
  }): Promise<StoredObjectHead | null> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.buckets[bucket], Key: key }),
      );
      return { sizeBytes: head.ContentLength ?? 0 };
    } catch (error) {
      if (error instanceof NotFound || (error as { name?: string }).name === 'NotFound') {
        return null;
      }
      throw error;
    }
  }

  async get({ bucket, key }: { bucket: StorageBucket; key: string }): Promise<Buffer> {
    const object = await this.client.send(
      new GetObjectCommand({ Bucket: this.buckets[bucket], Key: key }),
    );
    if (!object.Body) throw new Error(`Objeto sem corpo: ${key}`);
    return Buffer.from(await object.Body.transformToByteArray());
  }

  async put({
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
  }): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.buckets[bucket],
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: cacheControl,
      }),
    );
  }

  async delete({
    bucket,
    keys,
  }: {
    bucket: StorageBucket;
    keys: readonly string[];
  }): Promise<void> {
    for (let start = 0; start < keys.length; start += DELETE_BATCH) {
      const batch = keys.slice(start, start + DELETE_BATCH);
      const result = await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.buckets[bucket],
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      if (result.Errors?.length) {
        const [first] = result.Errors;
        throw new Error(
          `Falha ao apagar ${result.Errors.length} objeto(s) no armazenamento: ${first?.Code ?? 'erro'}`,
        );
      }
    }
  }

  publicUrl({ key }: { key: string }): string {
    return `${this.publicBaseUrl}/${key}`;
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }
}
