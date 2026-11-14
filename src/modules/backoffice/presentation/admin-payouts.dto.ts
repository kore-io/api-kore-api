import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import {
  PAYOUT_QUEUE_TABS,
  type PayoutQueueRow,
  type PayoutQueueTab,
} from '../../billing/application/ports/payout-admin.store.port';

export class AdminPayoutsQuery {
  /** Solicitados · Retidos · Histórico (decisão 259(3)). */
  @ApiProperty({ enum: PAYOUT_QUEUE_TABS, required: false, default: 'requested' })
  @IsOptional()
  @IsIn(PAYOUT_QUEUE_TABS)
  status?: PayoutQueueTab;

  /** Os repasses de um indicador (a aba Repasses do detalhe da cerimonialista). */
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  referrerId?: string;

  @ApiProperty({ required: false, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page?: number;
}

class AdminPayoutReferrerResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ['planner', 'seller'] }) kind: 'planner' | 'seller';
  name: string;
}

class AdminHeldCommissionResponse {
  /** "Comissão estornada: Ana e Marcos, R$ 67,42"; nulo com o casamento apagado. */
  @ApiProperty({ type: String, nullable: true }) coupleNames: string | null;
  amountCents: number;
  @ApiProperty({ enum: ['held', 'reversed', 'blocked'] }) status: string;
}

class AdminPayoutResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ['requested', 'held', 'processing', 'paid', 'rejected'] }) status: string;
  @ApiProperty({ type: AdminPayoutReferrerResponse }) referrer: AdminPayoutReferrerResponse;
  amountCents: number;
  pixKeyMasked: string;
  @ApiProperty({ format: 'date-time' }) requestedAt: string;
  @ApiProperty({
    type: String,
    nullable: true,
    enum: ['refund', 'pix_key_change', 'referrer_blocked', 'dispute', 'commission_blocked'],
  })
  holdReason: string | null;
  @ApiProperty({ type: [AdminHeldCommissionResponse] })
  heldCommissions: AdminHeldCommissionResponse[];
  /** "Troca de chave Pix em andamento, vale em 28/09 às 14h". */
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) pixKeyActiveFrom:
    string | null;
  /** O valor do Liberar (só no retido): sem as estornadas e as bloqueadas. */
  @ApiProperty({ type: Number, nullable: true }) releaseAmountCents: number | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) processingAt: string | null;
  @ApiProperty({ type: String, nullable: true }) lastError: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) paidAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) rejectedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) rejectReason: string | null;
}

const iso = (value: Date | null) => value?.toISOString() ?? null;

export class AdminPayoutsResponse {
  @ApiProperty({ type: [AdminPayoutResponse] }) items: AdminPayoutResponse[];
  page: number;
  pageSize: number;
  total: number;

  static from({
    page,
    result,
  }: {
    page: number;
    result: { items: PayoutQueueRow[]; total: number; pageSize: number };
  }): AdminPayoutsResponse {
    return {
      page,
      pageSize: result.pageSize,
      total: result.total,
      items: result.items.map((row) => ({
        ...row,
        requestedAt: row.requestedAt.toISOString(),
        pixKeyActiveFrom: iso(row.pixKeyActiveFrom),
        processingAt: iso(row.processingAt),
        paidAt: iso(row.paidAt),
        rejectedAt: iso(row.rejectedAt),
      })),
    };
  }
}

export class PayoutActionResponse {
  @ApiProperty({
    enum: ['processing', 'paid', 'failed', 'pending', 'unchanged', 'rejected', 'requested'],
  })
  status: string;
  /** O valor depois do Liberar. */
  @ApiProperty({ required: false }) amountCents?: number;
}
