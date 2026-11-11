import { Inject, Injectable } from '@nestjs/common';
import { uuidV7 } from '../../../shared/ids/uuid-v7';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from '../../../shared/storage/application/object-storage.port';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import {
  SITE_IMAGE_UPLOAD_SECONDS,
  SITE_IMAGES_PER_WEDDING_MAX,
  STORED_SITE_IMAGE_STATUSES,
  siteImageKeys,
  type SiteImageUploadContentType,
} from '../domain/site-image';
import { SiteImageLimitReachedError } from '../domain/site.errors';
import { SITE_IMAGE_STORE, type SiteImageStore } from './ports/site-image-store.port';

export interface SiteImageUploadAuthorization {
  imageId: string;
  uploadUrl: string;
  method: 'PUT';
  headers: { 'Content-Type': string; 'Content-Length': string };
  expiresAt: Date;
}

/**
 * Autorização de envio de uma imagem do site (S4 RN04 e RN07; ADR do upload
 * direto): confere o vínculo e o limite de 40 guardadas com o lock do
 * casamento, cria o SiteImage em `uploading` e assina o PUT do original no
 * bucket privado, preso à chave, ao tipo e ao tamanho, por 5 minutos.
 */
@Injectable()
export class AuthorizeSiteImageUpload {
  constructor(
    private readonly authorization: WeddingAuthorization,
    @Inject(SITE_IMAGE_STORE) private readonly images: SiteImageStore,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async execute({
    userId,
    weddingId,
    contentType,
    sizeBytes,
    now,
  }: {
    userId: string;
    weddingId: string;
    contentType: SiteImageUploadContentType;
    sizeBytes: number;
    now: Date;
  }): Promise<SiteImageUploadAuthorization> {
    await this.authorization.require({ userId, weddingId, action: 'manage_site' });
    await this.images.lockWedding({ weddingId });
    const stored = await this.images.countByStatus({
      weddingId,
      statuses: STORED_SITE_IMAGE_STATUSES,
    });
    if (stored >= SITE_IMAGES_PER_WEDDING_MAX) throw new SiteImageLimitReachedError();

    const imageId = uuidV7({ now: now.getTime() });
    const keys = siteImageKeys({ imageId });
    await this.images.createUploading({
      id: imageId,
      weddingId,
      storageKey: keys.display,
      sizeBytes,
      uploadedByUserId: userId,
    });
    // A assinatura é local (sem ida ao armazenamento), então fica na transação.
    const upload = await this.storage.presignPut({
      bucket: 'private',
      key: keys.original,
      contentType,
      sizeBytes,
      now,
      expiresInSeconds: SITE_IMAGE_UPLOAD_SECONDS,
    });
    return {
      imageId,
      uploadUrl: upload.url,
      method: 'PUT',
      headers: upload.headers,
      expiresAt: upload.expiresAt,
    };
  }
}
