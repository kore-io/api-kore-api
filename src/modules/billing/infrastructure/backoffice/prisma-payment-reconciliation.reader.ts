import { Injectable } from '@nestjs/common';
import { BackofficePrismaService } from '../../../../shared/database/backoffice-prisma.service';
import type {
  PaymentReconciliationReader,
  ReconcilingPayment,
} from '../../application/ports/payment-reconciliation.reader.port';

const SELECT = {
  id: true,
  weddingId: true,
  kind: true,
  method: true,
  status: true,
  dueAt: true,
  createdAt: true,
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pela conexão do backoffice (kore_backoffice), fora de transação (RN19). */
@Injectable()
export class PrismaPaymentReconciliationReader implements PaymentReconciliationReader {
  constructor(private readonly db: BackofficePrismaService) {}

  stalePending({
    createdBefore,
    weddingId,
    limit,
  }: {
    createdBefore: Date;
    weddingId?: string;
    limit: number;
  }): Promise<ReconcilingPayment[]> {
    // Pelo índice parcial dos pendentes por created_at.
    return this.db.payment.findMany({
      where: {
        status: 'pending',
        createdAt: { lt: createdBefore },
        ...(weddingId ? { weddingId } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: SELECT,
    });
  }

  settled({
    afterId,
    weddingId,
    limit,
  }: {
    afterId: string | null;
    weddingId?: string;
    limit: number;
  }): Promise<ReconcilingPayment[]> {
    return this.db.payment.findMany({
      where: {
        status: { in: ['paid', 'refund_requested', 'disputed'] },
        ...(afterId ? { id: { gt: afterId } } : {}),
        ...(weddingId ? { weddingId } : {}),
      },
      orderBy: { id: 'asc' },
      take: limit,
      select: SELECT,
    });
  }

  byReferences({ references }: { references: string[] }): Promise<ReconcilingPayment[]> {
    // A referência de outro sistema no gateway não é um UUID: não é do Kore.
    const ids = references.filter((reference) => UUID.test(reference));
    if (ids.length === 0) return Promise.resolve([]);
    return this.db.payment.findMany({ where: { id: { in: ids } }, select: SELECT });
  }
}
