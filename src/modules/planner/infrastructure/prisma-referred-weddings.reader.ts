import { Injectable } from '@nestjs/common';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type {
  ReferredWeddingRow,
  ReferredWeddingsReader,
} from '../application/ports/referred-weddings-reader.port';
import type { MyWeddingStatus } from '../domain/my-weddings';

@Injectable()
export class PrismaReferredWeddingsReader implements ReferredWeddingsReader {
  constructor(private readonly tenant: TenantTransaction) {}

  async list(): Promise<ReferredWeddingRow[]> {
    const rows = await this.tenant.client().$queryRaw<
      {
        wedding_id: string;
        status: MyWeddingStatus;
        created_at: Date;
        partner1_name: string | null;
        partner2_name: string | null;
        clickable: boolean;
      }[]
    >`SELECT * FROM referred_weddings()`;
    return rows.map((row) => ({
      weddingId: row.wedding_id,
      status: row.status,
      createdAt: row.created_at,
      partnerNames: [row.partner1_name ?? '', row.partner2_name ?? ''],
      clickable: row.clickable,
    }));
  }
}
