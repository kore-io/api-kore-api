import { Injectable } from '@nestjs/common';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type {
  PublicationStore,
  PublicationTarget,
} from '../application/ports/publication-store.port';

/** Na transação da requisição, com a RLS ligada. */
@Injectable()
export class PrismaPublicationStore implements PublicationStore {
  constructor(private readonly tenant: TenantTransaction) {}

  async lock({ weddingId }: { weddingId: string }): Promise<PublicationTarget | null> {
    const [row] = await this.tenant.client().$queryRaw<PublicationTarget[]>`
      SELECT status::text AS status, slug::text AS slug,
             to_char(event_date, 'YYYY-MM-DD') AS "eventDate", timezone,
             published_at AS "publishedAt"
      FROM weddings WHERE id = ${weddingId}::uuid FOR UPDATE`;
    return row ?? null;
  }

  async publishByCourtesy({
    weddingId,
    endDate,
    userId,
    now,
  }: {
    weddingId: string;
    endDate: string;
    userId: string;
    now: Date;
  }): Promise<void> {
    // paidThrough fica nulo na Cortesia (decisão 217(4)); nenhum Payment.
    await this.tenant.client().wedding.updateMany({
      where: { id: weddingId, status: 'draft' },
      data: {
        status: 'published',
        publishedAt: now,
        endDate: new Date(`${endDate}T00:00:00Z`),
        publicationSource: 'courtesy',
        publishedByUserId: userId,
      },
    });
  }

  async notifyPublished({
    notificationIds,
  }: {
    notificationIds: readonly string[];
  }): Promise<string[]> {
    const [row] = await this.tenant.client().$queryRaw<[{ recipients: string[] }]>`
      SELECT notify_wedding_published(${[...notificationIds]}::uuid[]) AS recipients`;
    return row?.recipients ?? [];
  }
}
