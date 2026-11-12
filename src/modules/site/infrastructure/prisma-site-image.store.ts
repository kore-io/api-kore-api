import { Injectable } from '@nestjs/common';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type { SiteImageRow, SiteImageStore } from '../application/ports/site-image-store.port';
import type { SiteImageStatus } from '../domain/site-image';

/** Na transação da requisição, com a RLS ligada. */
@Injectable()
export class PrismaSiteImageStore implements SiteImageStore {
  constructor(private readonly tenant: TenantTransaction) {}

  async lockWedding({ weddingId }: { weddingId: string }): Promise<void> {
    await this.tenant.client()
      .$queryRaw`SELECT id FROM weddings WHERE id = ${weddingId}::uuid FOR UPDATE`;
  }

  countByStatus({
    weddingId,
    statuses,
  }: {
    weddingId: string;
    statuses: readonly SiteImageStatus[];
  }): Promise<number> {
    return this.tenant
      .client()
      .siteImage.count({ where: { weddingId, status: { in: [...statuses] } } });
  }

  async createUploading({
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
  }): Promise<void> {
    await this.tenant.client().siteImage.create({
      data: { id, weddingId, storageKey, sizeBytes, uploadedByUserId, status: 'uploading' },
      select: { id: true },
    });
  }

  async claimForProcessing({
    weddingId,
    imageId,
  }: {
    weddingId: string;
    imageId: string;
  }): Promise<boolean> {
    const { count } = await this.tenant.client().siteImage.updateMany({
      where: { id: imageId, weddingId, status: 'uploading' },
      data: { status: 'processing' },
    });
    return count === 1;
  }

  find({
    weddingId,
    imageId,
  }: {
    weddingId: string;
    imageId: string;
  }): Promise<SiteImageRow | null> {
    return this.tenant
      .client()
      .siteImage.findFirst({ where: { id: imageId, weddingId }, select: ROW });
  }

  async markReady({
    weddingId,
    imageId,
    sizeBytes,
    width,
    height,
    thumbKey,
    ogKey,
    now,
  }: {
    weddingId: string;
    imageId: string;
    sizeBytes: number;
    width: number;
    height: number;
    thumbKey: string;
    ogKey: string;
    now: Date;
  }): Promise<SiteImageRow | null> {
    const { count } = await this.tenant.client().siteImage.updateMany({
      where: { id: imageId, weddingId, status: 'processing' },
      data: {
        status: 'ready',
        sizeBytes,
        width,
        height,
        thumbKey,
        ogKey,
        readyAt: now,
        unusedSince: now,
      },
    });
    if (count !== 1) return null;
    return this.tenant.client().siteImage.findUnique({ where: { id: imageId }, select: ROW });
  }

  async markFailed({ weddingId, imageId }: { weddingId: string; imageId: string }): Promise<void> {
    await this.tenant.client().siteImage.updateMany({
      where: { id: imageId, weddingId, status: 'processing' },
      data: { status: 'failed' },
    });
  }

  async releaseToUploading({
    weddingId,
    imageId,
  }: {
    weddingId: string;
    imageId: string;
  }): Promise<void> {
    await this.tenant.client().siteImage.updateMany({
      where: { id: imageId, weddingId, status: 'processing' },
      data: { status: 'uploading' },
    });
  }
}

const ROW = {
  id: true,
  status: true,
  storageKey: true,
  thumbKey: true,
  width: true,
  height: true,
} as const;
