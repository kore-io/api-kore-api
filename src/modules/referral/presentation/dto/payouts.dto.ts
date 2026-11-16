import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

const STATUSES = ['requested', 'held', 'processing', 'paid', 'rejected'] as const;
const HOLD_REASONS = [
  'refund',
  'pix_key_change',
  'referrer_blocked',
  'dispute',
  'commission_blocked',
] as const;

export class RequestPayoutBody {
  /** O valor do Dialog "Pedir o repasse de R$ 158,04?" (decisão 247(1)). */
  @ApiProperty({ example: 15804 })
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  expectedAmountCents: number;
}

export class PayoutResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 15804 }) amountCents: number;
  /** Solicitado · Retido · Em processamento · Pago · Recusado (RN09). */
  @ApiProperty({ enum: STATUSES }) status: (typeof STATUSES)[number];
  /** Por que está retido (RN06), para a legenda. */
  @ApiProperty({ enum: HOLD_REASONS, nullable: true }) holdReason:
    (typeof HOLD_REASONS)[number] | null;
  /** A chave do pedido, mascarada (decisão 25). */
  @ApiProperty({ example: 'jul***@pradoassessoria.com.br' }) pixKeyMasked: string;
  @ApiProperty({ format: 'date-time' }) requestedAt: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) paidAt: string | null;
  /** O motivo da recusa do Admin (RN07). */
  @ApiProperty({ type: String, nullable: true }) rejectReason: string | null;
  /** "Ver comprovante": nulo até o Pix de saída (PR 9c). */
  @ApiProperty({ type: String, nullable: true }) receiptUrl: string | null;
}

export class PayoutsResponse {
  /** Desligados: "Os repasses ainda não estão abertos. Suas comissões continuam guardadas." (RN01). */
  payoutsEnabled: boolean;
  /** "Você pode pedir de novo a partir de 26 de out." (00h de São Paulo); nulo quando já pode. */
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) nextRequestAt: string | null;
  /** A troca da chave que ainda não vale; nula sem troca. */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  pixKeyActiveFrom: string | null;
  /** "Você pode pedir o repasse a partir de R$ 50." */
  @ApiProperty({ example: 5000 }) minimumCents: number;
  @ApiProperty({ type: [PayoutResponse] }) items: PayoutResponse[];
}

const body409 = (code: string) => {
  class Body {
    static readonly status = 409;
    @ApiProperty({ enum: [409] }) statusCode: 409;
    @ApiProperty({ enum: [code] }) error: string;
    @ApiProperty() message: string;
  }
  return Body;
};

export class PayoutsDisabledErrorBody extends body409('PAYOUTS_DISABLED') {}
export class PayoutDataMissingErrorBody extends body409('PAYOUT_DATA_MISSING') {}

export class PayoutBelowMinimumErrorBody extends body409('PAYOUT_BELOW_MINIMUM') {
  /** "Faltam R$ 12,40." = minimumCents − balanceCents. */
  @ApiProperty({ example: 3760 }) balanceCents: number;
  @ApiProperty({ example: 5000 }) minimumCents: number;
}

export class PayoutTooSoonErrorBody extends body409('PAYOUT_TOO_SOON') {
  @ApiProperty({ format: 'date-time' }) nextRequestAt: string;
}

export class PayoutOpenErrorBody extends body409('PAYOUT_OPEN') {
  @ApiProperty({ format: 'uuid' }) payoutId: string;
}

export class PayoutAmountChangedErrorBody extends body409('PAYOUT_AMOUNT_CHANGED') {
  /** O saldo atual, para o Dialog de novo. */
  @ApiProperty({ example: 15804 }) amountCents: number;
}
