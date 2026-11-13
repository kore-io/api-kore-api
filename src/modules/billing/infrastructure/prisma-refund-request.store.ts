import { Injectable } from '@nestjs/common';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type {
  RefundRequestResult,
  RefundRequestStore,
} from '../application/ports/refund-request.store.port';

/** Na transação da requisição, com a RLS do dono (Publicar e pagar RN20). */
@Injectable()
export class PrismaRefundRequestStore implements RefundRequestStore {
  constructor(private readonly tenant: TenantTransaction) {}

  async request({
    weddingId,
    paymentId,
    reason,
    now,
    alertId,
  }: {
    weddingId: string;
    paymentId: string;
    reason: string | null;
    now: Date;
    alertId: string;
  }) {
    const [row] = await this.tenant.client().$queryRaw<
      { result: RefundRequestResult; payment_ids: string[]; refundable_until: Date | null }[]
    >`
      SELECT result, payment_ids, refundable_until
      FROM request_payment_refund(${weddingId}::uuid, ${paymentId}::uuid, ${reason},
                                  ${now}::timestamptz,
                                  ${alertId}::uuid)`;
    return {
      result: row?.result ?? 'not_found',
      paymentIds: row?.payment_ids ?? [],
      refundableUntil: row?.refundable_until ?? null,
    };
  }

  payments({ weddingId, ids }: { weddingId: string; ids: string[] }) {
    return this.tenant.client().payment.findMany({
      where: { weddingId, id: { in: ids } },
      select: { id: true, kind: true, amountCents: true },
    });
  }

  async pendingExtensionId({ weddingId }: { weddingId: string }): Promise<string | null> {
    const pending = await this.tenant.client().payment.findFirst({
      where: { weddingId, kind: 'extension', status: 'pending' },
      select: { id: true },
    });
    return pending?.id ?? null;
  }
}
