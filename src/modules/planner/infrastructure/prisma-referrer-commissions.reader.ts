import { Injectable } from '@nestjs/common';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type { ReferrerCommissionsReader } from '../application/ports/referrer-commissions-reader.port';
import type { CommissionRow } from '../domain/commissions';

@Injectable()
export class PrismaReferrerCommissionsReader implements ReferrerCommissionsReader {
  constructor(private readonly tenant: TenantTransaction) {}

  async list(): Promise<CommissionRow[]> {
    const rows = await this.tenant.client().$queryRaw<
      {
        id: string;
        wedding_id: string;
        wedding_purged: boolean;
        partner1_name: string | null;
        partner2_name: string | null;
        clickable: boolean;
        payment_kind: CommissionRow['paymentKind'];
        base_amount_cents: number;
        amount_cents: number;
        rate_percent: number;
        status: CommissionRow['status'];
        available_at: Date;
        paid_at: Date | null;
        created_at: Date;
        payout_id: string | null;
      }[]
    >`SELECT * FROM referrer_commissions()`;
    return rows.map((row) => ({
      id: row.id,
      weddingId: row.wedding_id,
      weddingPurged: row.wedding_purged,
      partnerNames: row.wedding_purged ? null : [row.partner1_name ?? '', row.partner2_name ?? ''],
      clickable: row.clickable,
      paymentKind: row.payment_kind,
      baseAmountCents: row.base_amount_cents,
      amountCents: row.amount_cents,
      ratePercent: row.rate_percent,
      status: row.status,
      availableAt: row.available_at,
      paidAt: row.paid_at,
      createdAt: row.created_at,
      payoutId: row.payout_id,
    }));
  }
}
