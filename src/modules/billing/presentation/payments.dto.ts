import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateBy,
  ValidateNested,
} from 'class-validator';
import { OptionalNotNull } from '../../../shared/http/optional-not-null';
import { DATE_ONLY } from '../../access/presentation/weddings.dto';
import type { PaymentCreated } from '../application/create-payment.use-case';
import type { BillingView } from '../application/get-billing.use-case';
import { isValidCpf } from '../domain/tax-id';

/** CPF válido, com ou sem máscara (Publicar e pagar RN02). */
function IsCpf(): PropertyDecorator {
  return ValidateBy({
    name: 'isCpf',
    validator: {
      validate: (value: unknown) => typeof value === 'string' && isValidCpf({ value }),
      // A mensagem nunca leva o número (B2-13).
      defaultMessage: () => 'taxId must be a valid CPF',
    },
  });
}

export class PayerBody {
  /** Nome completo de quem paga (pode ser outra pessoa). */
  @ApiProperty({ example: 'Ana Beatriz Moreira' })
  @IsString()
  @Matches(/\S/)
  @MinLength(2)
  @MaxLength(200)
  name: string;

  /** CPF de quem paga: vai só ao gateway; o Kore guarda o HMAC e os 4 últimos (RN02). */
  @ApiProperty({ example: '529.982.247-25' })
  @IsString()
  @IsCpf()
  taxId: string;
}

/** POST …/payments (Publicar e pagar RN03). */
export class CreatePaymentBody {
  /** Por ora só a publicação; a extensão entra no PR da data de saída do ar. */
  @ApiProperty({ enum: ['publication'] })
  @IsIn(['publication'])
  kind: 'publication';

  @ApiProperty({ example: '2027-02-14' })
  @Matches(DATE_ONLY)
  @IsISO8601({ strict: true })
  endDate: string;

  @ApiProperty({ enum: ['pix', 'card'] })
  @IsIn(['pix', 'card'])
  method: 'pix' | 'card';

  @ApiProperty({ minimum: 1, maximum: 12, example: 2 })
  @IsInt()
  @Min(1)
  @Max(12)
  installments: number;

  @ApiProperty({ type: PayerBody })
  @ValidateNested()
  @Type(() => PayerBody)
  payer: PayerBody;

  /** O token do cartão, quando o gateway tokeniza (B2-16); nunca o número. */
  @ApiProperty({ required: false })
  @OptionalNotNull()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  cardToken?: string;

  @ApiProperty({ example: '2026-11' })
  @IsString()
  @MaxLength(20)
  priceVersion: string;

  /** O total que o casal viu na cotação (Preço e cotação RN05). */
  @ApiProperty({ example: 33710 })
  @IsInt()
  @Min(1)
  expectedTotalCents: number;
}

export class PixDto {
  /** O QR é desenhado no navegador a partir do copia e cola. */
  @ApiProperty() copyPaste: string;
}

export class NextActionDto {
  @ApiProperty({ enum: ['none', 'redirect'] }) type: 'none' | 'redirect';
  @ApiProperty({ required: false }) url?: string;
}

const PAYMENT_STATUSES = [
  'pending',
  'paid',
  'failed',
  'canceled',
  'refund_requested',
  'refunded',
  'disputed',
] as const;

export class PaymentCreatedResponse {
  @ApiProperty({ format: 'uuid' }) paymentId: string;
  @ApiProperty({ enum: PAYMENT_STATUSES }) status: PaymentCreated['status'];
  @ApiProperty({ enum: ['pix', 'card'] }) method: 'pix' | 'card';
  @ApiProperty({ example: 33710 }) amountCents: number;
  @ApiProperty({ type: String, format: 'date-time', required: false }) dueAt?: string;
  @ApiProperty({ type: PixDto, required: false }) pix?: PixDto;
  /** Só no cartão recusado na hora: `card_declined`. */
  @ApiProperty({ type: String, required: false }) failureReason?: string;
  @ApiProperty({ type: NextActionDto }) nextAction: NextActionDto;

  static from({ payment }: { payment: PaymentCreated }): PaymentCreatedResponse {
    return {
      paymentId: payment.paymentId,
      status: payment.status,
      method: payment.method,
      amountCents: payment.amountCents,
      ...(payment.dueAt ? { dueAt: payment.dueAt.toISOString() } : {}),
      ...(payment.pixCopyPaste ? { pix: { copyPaste: payment.pixCopyPaste } } : {}),
      ...(payment.failureReason ? { failureReason: payment.failureReason } : {}),
      nextAction: payment.nextAction,
    };
  }
}

export class PendingPaymentDto {
  @ApiProperty({ format: 'uuid' }) paymentId: string;
  @ApiProperty({ enum: ['publication', 'extension'] }) kind: 'publication' | 'extension';
  @ApiProperty({ enum: ['pix', 'card'] }) method: 'pix' | 'card';
  @ApiProperty() amountCents: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) dueAt: string | null;
  @ApiProperty({ type: String, nullable: true }) pixCopyPaste: string | null;
}

export class BillingPaymentDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ['publication', 'extension'] }) kind: 'publication' | 'extension';
  @ApiProperty({ example: '2026-08-10' }) periodStart: string;
  @ApiProperty({ example: '2027-02-14' }) periodEnd: string;
  @ApiProperty() monthsCovered: number;
  @ApiProperty() amountCents: number;
  @ApiProperty({ enum: ['pix', 'card'] }) method: 'pix' | 'card';
  @ApiProperty() installments: number;
  @ApiProperty({ enum: PAYMENT_STATUSES }) status: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) paidAt: string | null;
}

export class PayerDto {
  @ApiProperty() name: string;
  @ApiProperty({ example: '4821' }) taxIdLast4: string;
}

/**
 * GET …/billing: o status e as datas para todo vínculo; os campos de valor
 * (`pendingPayment`, `payments`, `payer`) só para o dono.
 */
export class BillingResponse {
  @ApiProperty() status: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) publishedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) endDate: string | null;
  @ApiProperty({ type: String, nullable: true }) paidThrough: string | null;
  @ApiProperty({ type: String, nullable: true }) graceUntil: string | null;
  @ApiProperty({ type: String, nullable: true }) expiredAt: string | null;
  @ApiProperty({ type: String, nullable: true }) purgeAt: string | null;
  @ApiProperty({ enum: ['courtesy', 'payment'], nullable: true })
  publicationSource: 'courtesy' | 'payment' | null;
  /** "Aguardando pagamento" (RN06): rascunho com publicação pendente. */
  @ApiProperty() awaitingPayment: boolean;
  @ApiProperty({ type: PendingPaymentDto, nullable: true, required: false })
  pendingPayment?: PendingPaymentDto | null;
  @ApiProperty({ type: [BillingPaymentDto], required: false }) payments?: BillingPaymentDto[];
  @ApiProperty({ type: PayerDto, nullable: true, required: false }) payer?: PayerDto | null;

  static from({ view }: { view: BillingView }): BillingResponse {
    const base: BillingResponse = {
      status: view.status,
      publishedAt: view.publishedAt?.toISOString() ?? null,
      endDate: view.endDate,
      paidThrough: view.paidThrough,
      graceUntil: view.graceUntil,
      expiredAt: view.expiredAt,
      purgeAt: view.purgeAt,
      publicationSource: view.publicationSource,
      awaitingPayment: view.awaitingPayment,
    };
    if (!view.money) return base;
    const { pendingPayment, payments, lastPayer } = view.money;
    return {
      ...base,
      pendingPayment: pendingPayment
        ? { ...pendingPayment, dueAt: pendingPayment.dueAt?.toISOString() ?? null }
        : null,
      payments: payments.map((payment) => ({
        ...payment,
        paidAt: payment.paidAt?.toISOString() ?? null,
      })),
      payer: lastPayer,
    };
  }
}
