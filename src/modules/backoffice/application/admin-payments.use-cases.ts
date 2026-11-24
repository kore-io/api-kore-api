import { Inject, Injectable } from '@nestjs/common';
import type { ApplicationLogWriter } from '@/modules/logs/application/ports/application-log-writer.port';
import { paymentsCsv } from '@/modules/backoffice/domain/payments-csv';
import type { StaffMember } from '@/modules/backoffice/domain/staff';
import { ADMIN_LOG_WRITER } from './admin-weddings.use-cases';
import {
  ADMIN_PAYMENTS_READER,
  type AdminPaymentDetail,
  type AdminPaymentQuery,
  type AdminPaymentRow,
  type AdminPaymentsReader,
} from './ports/admin-payments.reader.port';
import type { Page } from './ports/admin-weddings.reader.port';
import { PaymentNotFoundError } from '@/modules/billing/domain/billing.errors';
import { pastGatewayWindow } from '@/modules/billing/domain/refunds/refund-receipt';

/**
 * O detalhe com o aviso do Reembolsar (Backoffice - cobrança RN05; decisão
 * 316(11)(e)): passou do prazo de estorno do gateway, pela mesma constante da
 * resposta do Reembolsar (259(2)).
 */
export type AdminPaymentDetailView = AdminPaymentDetail & { pastGatewayWindow: boolean };

/** A Cobrança do Backoffice (RN03, RN04 e RN07): só o Admin. */
@Injectable()
export class AdminPayments {
  constructor(
    @Inject(ADMIN_PAYMENTS_READER) private readonly reader: AdminPaymentsReader,
    @Inject(ADMIN_LOG_WRITER) private readonly log: ApplicationLogWriter,
  ) {}

  list({ query }: { query: AdminPaymentQuery }): Promise<Page<AdminPaymentRow>> {
    return this.reader.list(query);
  }

  async detail({
    paymentId,
    now,
  }: {
    paymentId: string;
    now: Date;
  }): Promise<AdminPaymentDetailView> {
    const payment = await this.reader.detail({ paymentId });
    if (!payment) throw new PaymentNotFoundError();
    return {
      ...payment,
      pastGatewayWindow: pastGatewayWindow({
        method: payment.method as 'pix' | 'card',
        paidAt: payment.paidAt,
        now,
      }),
    };
  }

  /** Exportar CSV (RN07; B10-6): o arquivo e o log `payments.exported` com o período. */
  async export({
    staff,
    from,
    to,
    ip,
  }: {
    staff: StaffMember;
    from: Date;
    to: Date;
    ip: string | null;
  }): Promise<{ content: string; rows: number }> {
    const rows = await this.reader.exportRows({ from, to });
    await this.log.record({
      entry: {
        action: 'payments.exported',
        actorKind: 'admin',
        actorUserId: staff.userId,
        data: { from: from.toISOString(), to: to.toISOString(), rows: rows.length },
        ...(ip ? { ip } : {}),
      },
    });
    return { content: paymentsCsv(rows), rows: rows.length };
  }
}
