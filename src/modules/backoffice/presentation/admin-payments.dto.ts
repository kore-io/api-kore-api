import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDate, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import {
  ADMIN_PAYMENT_STATUSES,
  type AdminPaymentDetail,
  type AdminPaymentRow,
  type AdminPaymentStatus,
} from '../application/ports/admin-payments.reader.port';
import type { Page } from '../application/ports/admin-weddings.reader.port';
import {
  REFUND_RECEIPT_CONTENT_TYPES,
  REFUND_RECEIPT_MAX_BYTES,
  type RefundReceiptContentType,
} from '../../billing/domain/refund-receipt';
import { AdminReasonBody } from './admin-weddings.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const iso = (value: Date | null) => value?.toISOString() ?? null;

export class AdminPaymentsQuery {
  @ApiProperty({ enum: ADMIN_PAYMENT_STATUSES, required: false })
  @IsOptional()
  @IsIn(ADMIN_PAYMENT_STATUSES)
  status?: AdminPaymentStatus;

  @ApiProperty({ enum: ['publication', 'extension'], required: false })
  @IsOptional()
  @IsIn(['publication', 'extension'])
  kind?: 'publication' | 'extension';

  @ApiProperty({ enum: ['pix', 'card'], required: false })
  @IsOptional()
  @IsIn(['pix', 'card'])
  method?: 'pix' | 'card';

  @ApiProperty({ required: false, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiProperty({ required: false, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @ApiProperty({ required: false, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page?: number;
}

/** O período do CSV (RN07). */
export class AdminPaymentsExportQuery {
  @ApiProperty({ format: 'date-time' }) @Type(() => Date) @IsDate() from: Date;
  @ApiProperty({ format: 'date-time' }) @Type(() => Date) @IsDate() to: Date;
}

/** Reembolsar (RN05): o motivo é opcional e vai ao log. */
export class AdminRefundBody {
  @ApiProperty({ required: false, maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** Registrar reembolso feito por fora (RN11): o motivo e o comprovante, obrigatórios. */
export class ManualRefundBody extends AdminReasonBody {
  /** A chave do comprovante enviado (o `receiptKey` do envio; decisão 259(1)). */
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  receipt: string;
}

/** Estender como cortesia (RN06): os meses e o motivo. */
export class CourtesyBody extends AdminReasonBody {
  @ApiProperty({ minimum: 1, maximum: 12 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  months: number;
}

export class AdminPaymentRowResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'P-0431' }) code: string;
  @ApiProperty({ format: 'uuid' }) weddingId: string;
  @ApiProperty({ type: String, nullable: true }) coupleNames: string | null;
  @ApiProperty({ enum: ['publication', 'extension'] }) kind: string;
  amountCents: number;
  @ApiProperty({ enum: ['pix', 'card'] }) method: string;
  @ApiProperty({
    enum: ['pending', 'paid', 'failed', 'canceled', 'refund_requested', 'refunded', 'disputed'],
  })
  status: string;
  /** Pago e não aplicado: o pagamento sem destino, com o estorno automático. */
  applied: boolean;
  @ApiProperty({ type: String, nullable: true }) refundOrigin: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) paidAt: string | null;

  static from({ row }: { row: AdminPaymentRow }): AdminPaymentRowResponse {
    return { ...row, createdAt: row.createdAt.toISOString(), paidAt: iso(row.paidAt) };
  }
}

export class AdminPaymentsResponse {
  @ApiProperty({ type: [AdminPaymentRowResponse] }) items: AdminPaymentRowResponse[];
  page: number;
  pageSize: number;
  total: number;

  static from({ page }: { page: Page<AdminPaymentRow> }): AdminPaymentsResponse {
    return { ...page, items: page.items.map((row) => AdminPaymentRowResponse.from({ row })) };
  }
}

class AdminPaymentReferrerResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  name: string;
}

class AdminPaymentCommissionResponse {
  amountCents: number;
  /** O Admin vê o percentual (RN04). */
  ratePercent: number;
  status: string;
}

class AdminPaymentRefundResponse {
  @ApiProperty({ type: String, nullable: true }) origin: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) requestedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) reason: string | null;
  attempts: number;
  @ApiProperty({ type: String, nullable: true }) lastError: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) failedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) refundedAt: string | null;
  outsideGateway: boolean;
}

class AdminPaymentDisputeResponse {
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) disputedAt: string | null;
  /** "Prazo da defesa: até 16/11/2026, no Asaas". */
  @ApiProperty({ type: String, nullable: true }) deadline: string | null;
}

/** O detalhe do pagamento (RN04). */
export class AdminPaymentDetailResponse extends AdminPaymentRowResponse {
  installments: number;
  monthsCovered: number;
  periodStart: string;
  periodEnd: string;
  activationListCents: number;
  monthlyListCents: number;
  capDiscountCents: number;
  referralDiscountCents: number;
  pixDiscountCents: number;
  installmentInterestCents: number;
  @ApiProperty({ type: Number, nullable: true }) gatewayFeeCents: number | null;
  @ApiProperty({ type: Number, nullable: true }) netCents: number | null;
  payerTaxIdLast4: string;
  @ApiProperty({ type: String, nullable: true }) gatewayPaymentId: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) appliedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) appliedByAdminAt:
    string | null;
  @ApiProperty({ type: AdminPaymentReferrerResponse, nullable: true })
  referrer: AdminPaymentReferrerResponse | null;
  @ApiProperty({ type: AdminPaymentCommissionResponse, nullable: true })
  commission: AdminPaymentCommissionResponse | null;
  @ApiProperty({ type: AdminPaymentRefundResponse }) refund: AdminPaymentRefundResponse;
  @ApiProperty({ type: AdminPaymentDisputeResponse }) dispute: AdminPaymentDisputeResponse;

  static fromDetail({ detail }: { detail: AdminPaymentDetail }): AdminPaymentDetailResponse {
    return {
      ...detail,
      createdAt: detail.createdAt.toISOString(),
      paidAt: iso(detail.paidAt),
      appliedAt: iso(detail.appliedAt),
      appliedByAdminAt: iso(detail.appliedByAdminAt),
      refund: {
        ...detail.refund,
        requestedAt: iso(detail.refund.requestedAt),
        failedAt: iso(detail.refund.failedAt),
        refundedAt: iso(detail.refund.refundedAt),
      },
      dispute: { disputedAt: iso(detail.dispute.disputedAt), deadline: detail.dispute.deadline },
    };
  }
}

export class AdminRefundResponse {
  @ApiProperty({ enum: ['refund_requested'] }) status: 'refund_requested';
  @ApiProperty({ type: [String], format: 'uuid' }) refundsPaymentIds: string[];
  /** Passou do prazo de estorno do gateway: o estorno vai falhar (B3-6; decisão 259(2)). */
  pastGatewayWindow: boolean;
}

export class AdminPaymentActionResponse {
  @ApiProperty({ enum: ['applied', 'refund_retried', 'refunded'] }) status: string;
}

export class CourtesyResponse {
  @ApiProperty({ example: '2027-02-14' }) previousEndDate: string;
  /** A nova data de saída do ar ("Data de saída do ar estendida para 14/05/2027."). */
  @ApiProperty({ example: '2027-05-14' }) newEndDate: string;
  /** O Pix de extensão pendente que a cortesia cancelou (B10-5). */
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) canceledPaymentId: string | null;
}

/** O envio do comprovante (decisão 259(1)): PDF, JPG ou PNG até 10 MB. */
export class RefundReceiptUploadBody {
  @ApiProperty({ enum: REFUND_RECEIPT_CONTENT_TYPES })
  @IsIn(REFUND_RECEIPT_CONTENT_TYPES)
  contentType: RefundReceiptContentType;

  @ApiProperty({ minimum: 1, maximum: REFUND_RECEIPT_MAX_BYTES })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(REFUND_RECEIPT_MAX_BYTES)
  sizeBytes: number;
}

class PresignedHeadersResponse {
  @ApiProperty({ name: 'Content-Type' }) 'Content-Type': string;
  @ApiProperty({ name: 'Content-Length' }) 'Content-Length': string;
}

export class RefundReceiptUploadResponse {
  /** A chave que vai no `receipt` do Registrar reembolso feito por fora. */
  receiptKey: string;
  /** O PUT do arquivo, com os cabeçalhos assinados. */
  url: string;
  @ApiProperty({ type: PresignedHeadersResponse }) headers: PresignedHeadersResponse;
  @ApiProperty({ format: 'date-time' }) expiresAt: string;
}
