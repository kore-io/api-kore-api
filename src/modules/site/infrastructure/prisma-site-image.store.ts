import { Injectable } from '@nestjs/common';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type { SiteImageStore } from '../application/ports/site-image-store.port';
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
}
