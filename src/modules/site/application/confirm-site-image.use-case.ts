import { Inject, Injectable, Logger } from '@nestjs/common';
import { Semaphore } from '../../../shared/concurrency/semaphore';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from '../../../shared/storage/application/object-storage.port';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import { WeddingScope } from '../../access/application/wedding-scope.service';
import {
  SITE_IMAGE_CACHE_CONTROL,
  SITE_IMAGE_MAX_BYTES,
  detectSiteImageType,
  siteImageKeys,
} from '../domain/site-image';
import {
  SiteImageInvalidError,
  SiteImageNotFoundError,
  SiteImageProcessingError,
  SiteImageUploadMissingError,
} from '../domain/site.errors';
import { SITE_IMAGE_PROCESSOR, type SiteImageProcessor } from './ports/site-image-processor.port';
import {
  SITE_IMAGE_STORE,
  type SiteImageRow,
  type SiteImageStore,
} from './ports/site-image-store.port';

const logger = new Logger('ConfirmSiteImage');

/** No máximo 2 processamentos simultâneos por instância, com fila em memória (S4 RN05). */
const PROCESSING_SLOTS = 2;

export interface SiteImageView {
  id: string;
  status: 'ready';
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
}

/**
 * Confirmação do envio, com o processamento na hora (S4 RN05; decisão 207,
 * item 1). Três passos, e só o primeiro e o último no banco, em transações
 * curtas: (1) `uploading` → `processing` de forma atômica (ou a imagem `ready`
 * devolvida como está, confirmação idempotente); (2) fora da transação, o
 * HeadObject antes de baixar, o tipo pelo conteúdo, a recodificação e as três
 * versões; (3) `ready`, com `unusedSince = readyAt`. O que não serve fica
 * `failed`, com o original apagado.
 */
@Injectable()
export class ConfirmSiteImage {
  private readonly slots = new Semaphore(PROCESSING_SLOTS);

  constructor(
    private readonly scope: WeddingScope,
    private readonly authorization: WeddingAuthorization,
    @Inject(SITE_IMAGE_STORE) private readonly images: SiteImageStore,
    @Inject(SITE_IMAGE_PROCESSOR) private readonly processor: SiteImageProcessor,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async execute({
    userId,
    weddingId,
    imageId,
    now,
  }: {
    userId: string;
    weddingId: string;
    imageId: string;
    now: () => Date;
  }): Promise<{ image: SiteImageView; processed: boolean }> {
    const claim = await this.scope.run({
      userId,
      weddingId,
      work: async () => {
        await this.authorization.require({ userId, weddingId, action: 'manage_site' });
        if (await this.images.claimForProcessing({ weddingId, imageId })) return null;
        const image = await this.images.find({ weddingId, imageId });
        if (!image || image.status === 'failed') throw new SiteImageNotFoundError();
        if (image.status === 'ready') return image;
        throw new SiteImageProcessingError();
      },
    });
    if (claim) return { image: this.view(claim), processed: false };

    const keys = siteImageKeys({ imageId });
    let processed: Awaited<ReturnType<SiteImageProcessor['process']>>;
    try {
      processed = await this.slots.run(async () => {
        const result = await this.process({ originalKey: keys.original });
        await Promise.all(
          (['display', 'thumb', 'og'] as const).map((version) =>
            this.storage.put({
              bucket: 'public',
              key: keys[version],
              body: result[version].body,
              contentType: 'image/jpeg',
              cacheControl: SITE_IMAGE_CACHE_CONTROL,
            }),
          ),
        );
        await this.storage.delete({ bucket: 'private', keys: [keys.original] });
        return result;
      });
    } catch (error) {
      await this.giveBack({ userId, weddingId, imageId, error, originalKey: keys.original });
      throw error;
    }

    const ready = await this.scope.run({
      userId,
      weddingId,
      work: () =>
        this.images.markReady({
          imageId,
          sizeBytes: processed.display.body.length,
          width: processed.display.width,
          height: processed.display.height,
          thumbKey: keys.thumb,
          ogKey: keys.og,
          now: now(),
        }),
    });
    // Só a rotina tira uma imagem de `processing` por fora (depois de 1 hora).
    if (!ready) throw new SiteImageNotFoundError();
    return { image: this.view(ready), processed: true };
  }

  /** O HeadObject antes de baixar (o R2 pode não impor o tamanho assinado) e o tipo real. */
  private async process({ originalKey }: { originalKey: string }) {
    const head = await this.storage.head({ bucket: 'private', key: originalKey });
    if (!head) throw new SiteImageUploadMissingError();
    if (head.sizeBytes > SITE_IMAGE_MAX_BYTES) throw new SiteImageInvalidError();
    const source = await this.storage.get({ bucket: 'private', key: originalKey });
    if (!detectSiteImageType({ head: source.subarray(0, 16) })) throw new SiteImageInvalidError();
    return this.processor.process({ source });
  }

  /**
   * Arquivo que não serve: `failed` e o original apagado. Original que não
   * chegou ou falha do armazenamento: volta a `uploading`, para o app tentar
   * de novo (sem isso, a imagem ficaria presa em `processing` até a rotina).
   */
  private async giveBack({
    userId,
    weddingId,
    imageId,
    error,
    originalKey,
  }: {
    userId: string;
    weddingId: string;
    imageId: string;
    error: unknown;
    originalKey: string;
  }): Promise<void> {
    try {
      if (error instanceof SiteImageInvalidError) {
        await this.storage.delete({ bucket: 'private', keys: [originalKey] });
        await this.scope.run({
          userId,
          weddingId,
          work: () => this.images.markFailed({ imageId }),
        });
        return;
      }
      await this.scope.run({
        userId,
        weddingId,
        work: () => this.images.releaseToUploading({ imageId }),
      });
    } catch (cleanupError) {
      // A rotina de limpeza apaga o que ficou em `processing` depois de 1 hora.
      logger.error(`Falha ao devolver a imagem (${(cleanupError as Error).name}).`);
    }
  }

  private view(image: SiteImageRow): SiteImageView {
    if (image.thumbKey === null || image.width === null || image.height === null)
      throw new Error('Imagem pronta sem as versões.');
    return {
      id: image.id,
      status: 'ready',
      url: this.storage.publicUrl({ key: image.storageKey }),
      thumbUrl: this.storage.publicUrl({ key: image.thumbKey }),
      width: image.width,
      height: image.height,
    };
  }
}
