import { Injectable } from '@nestjs/common';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type {
  PayoutRequestResult,
  PayoutRow,
  PayoutStore,
} from '../application/ports/payout-store.port';

/** Na transação da requisição, com a RLS ligada (o kore_app só lê; pede pela função). */
@Injectable()
export class PrismaPayoutStore implements PayoutStore {
  constructor(private readonly tenant: TenantTransaction) {}

  async isPlanner({ userId }: { userId: string }): Promise<boolean> {
    const referrer = await this.tenant.client().referrer.findFirst({
      where: { userId, kind: 'planner', status: 'active' },
      select: { id: true },
    });
    return referrer !== null;
  }

  async request(input: {
    id: string;
    idempotencyKey: string;
    expectedCents: number;
    externalRef: string;
    now: Date;
  }): Promise<PayoutRequestResult> {
    const [row] = await this.tenant.client().$queryRaw<
      {
        result: string;
        payout_id: string | null;
        amount_cents: number | null;
        next_request_at: Date | null;
        active_from: Date | null;
      }[]
    >`SELECT * FROM request_referrer_payout(${input.id}::uuid, ${input.idempotencyKey}::uuid,
        ${input.expectedCents}::integer, ${input.externalRef}, ${input.now}::timestamptz)`;
    switch (row.result) {
      case 'created':
      case 'existing':
        return { result: row.result, payoutId: row.payout_id!, amountCents: row.amount_cents! };
      case 'change_pending':
        return { result: 'change_pending', activeFrom: row.active_from! };
      case 'payout_open':
        return { result: 'payout_open', payoutId: row.payout_id! };
      case 'too_soon':
        return { result: 'too_soon', nextRequestAt: row.next_request_at! };
      case 'below_minimum':
      case 'amount_changed':
        return { result: row.result, amountCents: row.amount_cents! };
      default:
        return { result: row.result as 'key_reused' | 'no_referrer' | 'data_missing' };
    }
  }

  list(): Promise<PayoutRow[]> {
    return this.tenant.client().payout.findMany({
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        amountCents: true,
        status: true,
        holdReason: true,
        pixKeyMasked: true,
        requestedAt: true,
        paidAt: true,
        rejectedAt: true,
        rejectReason: true,
      },
    });
  }

  async minimumCents(): Promise<number> {
    const [row] = await this.tenant.client().$queryRaw<{ payout_min_cents: number }[]>`
      SELECT payout_min_cents FROM referral_settings ORDER BY created_at DESC LIMIT 1`;
    return row?.payout_min_cents ?? 5_000;
  }
}
