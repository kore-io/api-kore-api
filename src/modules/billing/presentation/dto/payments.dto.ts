import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsDefined,
  IsInt,
  IsISO8601,
  IsObject,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateBy,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { OptionalNotNull } from '@/shared/http/optional-not-null';
import { DATE_ONLY } from '@/modules/access/presentation/dto/weddings.dto';
import type { PaymentCreated } from '@/modules/billing/application/payments/create-payment.use-case';
import type { BillingView } from '@/modules/billing/application/payments/get-billing.use-case';
import { isValidCpf } from '@/modules/billing/domain/payments/tax-id';

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

/** O `payerId` vem sozinho: com ele, o nome e o CPF não entram (decisão 316(3)). */
function IsAlonePayerId(): PropertyDecorator {
  return ValidateBy({
    name: 'isAlonePayerId',
    validator: {
      validate: (_value: unknown, args) => {
        const payer = args?.object as { name?: unknown; taxId?: unknown };
        return payer.name === undefined && payer.taxId === undefined;
      },
      defaultMessage: () => 'payerId must be sent without name and taxId',
    },
  });
}

/** Quem paga, pela primeira vez ou com outro CPF (Publicar e pagar RN02). */
export class NewPayerBody {
  /** Nome completo de quem paga (pode ser outra pessoa). */
  @ApiProperty({ example: 'Ana Beatriz Moreira', minLength: 2, maxLength: 200, pattern: '\\S' })
  name: string;
  /** CPF de quem paga: vai só ao gateway; o Kore guarda o HMAC e os 4 últimos (RN02). */
  @ApiProperty({ example: '529.982.247-25' }) taxId: string;
}

/**
 * O pagador anterior, sem o CPF (RN02 e RN03; decisão 316(3)): o `payer.payerId`
 * do GET …/billing. O Kore usa o nome e o cliente do gateway que já tem.
 */
export class PreviousPayerBody {
  @ApiProperty({ format: 'uuid' }) payerId: string;
}

/**
 * A validação das duas formas de `payer` (o OpenAPI as mostra em `oneOf`):
 * sem `payerId`, o nome e o CPF são obrigatórios; com ele, não entram.
 */
export class PayerBody {
  @ValidateIf((payer: PayerBody) => payer.payerId === undefined)
  @IsString()
  @Matches(/\S/)
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @ValidateIf((payer: PayerBody) => payer.payerId === undefined)
  @IsString()
  @IsCpf()
  taxId?: string;

  @OptionalNotNull()
  @IsUUID()
  @IsAlonePayerId()
  payerId?: string;
}

/** POST …/payments (Publicar e pagar RN03). */
@ApiExtraModels(NewPayerBody, PreviousPayerBody)
export class CreatePaymentBody {
  /** A publicação ou a extensão (Data de saída do ar RN04: adiar e renovar). */
  @ApiProperty({ enum: ['publication', 'extension'] })
  @IsIn(['publication', 'extension'])
  kind: 'publication' | 'extension';

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

  /** O nome e o CPF, ou o pagador anterior pelo `payerId` (decisão 316(3)). */
  @ApiProperty({
    oneOf: [{ $ref: getSchemaPath(NewPayerBody) }, { $ref: getSchemaPath(PreviousPayerBody) }],
  })
  // Ausente, nulo ou em lista: 400 (o @ValidateNested sozinho deixava passar e dava 500).
  @IsDefined()
  @IsObject()
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

  /**
   * O pendente que este pedido troca (RN07; B2-4): **Gerar novo Pix** e
   * trocar o Pix pelo cartão. O Kore cancela o anterior antes de criar este.
   */
  @ApiProperty({ required: false, format: 'uuid' })
  @OptionalNotNull()
  @IsUUID()
  replacesPaymentId?: string;

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
  /** A forma do pendente: o Publicar volta com ela escolhida (decisão 324). */
  @ApiProperty({ enum: ['pix', 'card'] }) method: 'pix' | 'card';
  /**
   * A data de saída do ar pedida (o `endDate` do POST …/payments): o Publicar
   * volta com ela preenchida (decisão 324(3)).
   */
  @ApiProperty({ example: '2027-02-14' }) endDate: string;
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
  /**
   * O último instante para desistir, no fuso do casamento (Pagamentos e
   * arrependimento RN02); nulo fora do prazo, fora de `paid` e no que o
   * Desistir recusa (a extensão que não é a última, ou com cortesia concedida
   * depois; RN03, decisão 345(1)). O app mostra
   * o dia: "Vocês podem desistir até 17 de ago.".
   */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  refundableUntil: string | null;
  /** O prazo da defesa, só em contestação (Pagamentos e arrependimento RN06). */
  @ApiProperty({ type: String, nullable: true, example: '2026-09-10' })
  disputeDeadline: string | null;
  /**
   * Só na extensão desistível (com `refundableUntil`): a data de saída do ar
   * para onde a `endDate` volta se ela for desistida, AAAA-MM-DD, já com a
   * regra da RN03 (`min(endDate atual, a data anterior gravada na
   * confirmação)`; decisão 327(2)). Nulo na publicação e no que não é
   * desistível.
   */
  @ApiProperty({ type: String, nullable: true, example: '2027-02-14' })
  refundEndDate: string | null;
}

export class PayerDto {
  @ApiProperty() name: string;
  @ApiProperty({ example: '4821' }) taxIdLast4: string;
  /**
   * Para pagar de novo sem o CPF, em `payer.payerId` do POST …/payments
   * (decisão 316(3)). Nulo quando o pagador não tem cliente no gateway atual:
   * o app pede o CPF.
   */
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) payerId: string | null;
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
        refundableUntil: payment.refundableUntil?.toISOString() ?? null,
        disputeDeadline: payment.disputeDeadline,
      })),
      payer: lastPayer,
    };
  }
}

/** Desistir e pedir reembolso (Pagamentos e arrependimento RN02). */
export class RefundRequestBody {
  /** O motivo, opcional (ex.: "Decidimos adiar o casamento."). */
  @ApiProperty({ required: false, maxLength: 500 })
  @OptionalNotNull()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class RefundRequestedResponse {
  @ApiProperty({ enum: ['refund_requested'] }) status: 'refund_requested';
  /** O pagamento pedido e, na publicação, as extensões pagas que vão junto (RN03). */
  @ApiProperty({ type: [String], format: 'uuid' }) refundsPaymentIds: string[];
}

/** Antecipar ou voltar a data de saída do ar (Data de saída do ar RN05). */
export class ChangeEndDateBody {
  /** `AAAA-MM-DD`: de amanhã (e depois do casamento) até o paidThrough. */
  @ApiProperty({ example: '2027-01-10' })
  @Matches(DATE_ONLY)
  @IsISO8601({ strict: true })
  endDate: string;
}

export class EndDateChangedResponse {
  @ApiProperty({ example: '2027-01-10' }) endDate: string;
  /** Não muda: voltar a data vai até ele, de graça (B4-1). */
  @ApiProperty({ type: String, nullable: true, example: '2027-02-14' }) paidThrough: string | null;
  @ApiProperty({ enum: ['published', 'post_event', 'grace'] }) status: string;
}
