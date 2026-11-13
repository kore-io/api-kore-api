import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, Matches, Max, Min } from 'class-validator';
import { OptionalNotNull } from '../../../shared/http/optional-not-null';
import { DATE_ONLY } from '../../access/presentation/weddings.dto';
import type { BillingQuote } from '../domain/quote';
import { CURRENT_PRICE_TABLE } from '../domain/pricing';

export class BillingQuoteQuery {
  @ApiProperty({ enum: ['publication', 'extension'] })
  @IsIn(['publication', 'extension'])
  kind: 'publication' | 'extension';

  /** `AAAA-MM-DD`. Sem ela, a resposta só traz os limites (endDateMin, endDateMax, canExtend). */
  @ApiProperty({ required: false, example: '2027-02-14' })
  @OptionalNotNull()
  @Matches(DATE_ONLY)
  @IsISO8601({ strict: true })
  endDate?: string;

  @ApiProperty({ enum: ['pix', 'card'] })
  @IsIn(['pix', 'card'])
  method: 'pix' | 'card';

  @ApiProperty({ required: false, minimum: 1, maximum: 12, default: 1 })
  @OptionalNotNull()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  installments?: number;
}

export class TotalsByMethodDto {
  @ApiProperty({ example: 32699 }) pix: number;
  @ApiProperty({ example: 33710 }) cardUpTo6: number;
  @ApiProperty({ example: 35104 }) cardChosen: number;
}

/** A cotação do servidor (Preço e cotação RN04): a única verdade do preço, em centavos. */
export class BillingQuoteResponse {
  @ApiProperty({ example: '2026-11' }) priceVersion: string;
  @ApiProperty({ type: Number, nullable: true, example: 7 }) monthsCovered: number | null;
  @ApiProperty({ example: '2026-08-10' }) periodStart: string;
  @ApiProperty({ type: String, nullable: true, example: '2027-02-14' }) periodEnd: string | null;
  @ApiProperty({ type: Number, nullable: true }) activationListCents: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'O preço de tabela de um mês.' })
  monthlyListCents: number | null;
  @ApiProperty({ type: Number, nullable: true }) listTotalCents: number | null;
  @ApiProperty({ type: Number, nullable: true }) capDiscountCents: number | null;
  @ApiProperty({ type: Number, nullable: true }) referralDiscountCents: number | null;
  @ApiProperty({ enum: ['assessoria', 'indicacao'], nullable: true })
  referralLabel: 'assessoria' | 'indicacao' | null;
  @ApiProperty({ type: Number, nullable: true }) pixDiscountCents: number | null;
  @ApiProperty({ type: Number, nullable: true }) installmentInterestCents: number | null;
  @ApiProperty({ type: Number, nullable: true }) totalCents: number | null;
  @ApiProperty({ type: Number, nullable: true }) installments: number | null;
  @ApiProperty({ type: Number, nullable: true }) installmentCents: number | null;
  @ApiProperty({ type: Number, nullable: true }) firstInstallmentCents: number | null;
  @ApiProperty({ type: Number, nullable: true }) maxInstallments: number | null;
  @ApiProperty({ type: TotalsByMethodDto, nullable: true })
  totalsByMethod: TotalsByMethodDto | null;
  @ApiProperty({ type: String, nullable: true, example: '2026-11-15' }) endDateMin: string | null;
  @ApiProperty({ example: '2027-11-14' }) endDateMax: string;
  @ApiProperty() canExtend: boolean;
  @ApiProperty({ enum: ['END_DATE_LIMIT_REACHED'], nullable: true })
  cannotExtendReason: 'END_DATE_LIMIT_REACHED' | null;

  static from({ quote }: { quote: BillingQuote }): BillingQuoteResponse {
    const lines = quote.lines;
    return {
      priceVersion: quote.priceVersion,
      monthsCovered: lines?.monthsCovered ?? null,
      periodStart: quote.periodStart,
      periodEnd: quote.periodEnd,
      activationListCents: lines?.activationListCents ?? null,
      monthlyListCents: lines?.monthlyListCents ?? null,
      listTotalCents: lines?.listTotalCents ?? null,
      capDiscountCents: lines?.capDiscountCents ?? null,
      referralDiscountCents: lines?.referralDiscountCents ?? null,
      referralLabel: lines && lines.referralDiscountCents > 0 ? quote.referralLabel : null,
      pixDiscountCents: lines?.pixDiscountCents ?? null,
      installmentInterestCents: lines?.installmentInterestCents ?? null,
      totalCents: lines?.totalCents ?? null,
      installments: lines?.installments ?? null,
      installmentCents: lines?.installmentCents ?? null,
      firstInstallmentCents: lines?.firstInstallmentCents ?? null,
      maxInstallments: lines?.maxInstallments ?? null,
      totalsByMethod: lines?.totalsByMethod ?? null,
      endDateMin: quote.endDateMin,
      endDateMax: quote.endDateMax,
      canExtend: quote.canExtend,
      cannotExtendReason: quote.cannotExtendReason,
    };
  }
}

export class PricingInstallmentsDto {
  @ApiProperty({ example: 12 }) max: number;
  @ApiProperty({ example: 6 }) interestFreeUpTo: number;
  /** 3,99% de 7x a 12x. Só para mostrar: a conta em inteiros usa interestBasisPoints. */
  @ApiProperty({ example: 3.99 }) interestPercent: number;
  @ApiProperty({ example: 399 }) interestBasisPoints: number;
  @ApiProperty({ example: 49 }) interestFixedCents: number;
  @ApiProperty({ example: 500 }) minInstallmentCents: number;
}

/** O preço público (Preço e cotação RN07): o Institucional calcula só para mostrar. */
export class PricingResponse {
  @ApiProperty({ example: '2026-11' }) priceVersion: string;
  @ApiProperty({ example: 14900 }) activationCents: number;
  @ApiProperty({ example: 2900 }) monthlyCents: number;
  @ApiProperty({ example: 44900 }) capCents: number;
  @ApiProperty({ example: 3 }) pixDiscountPercent: number;
  @ApiProperty({ type: PricingInstallmentsDto }) installments: PricingInstallmentsDto;
  @ApiProperty({ example: 12 }) endDateMaxMonthsAfterEvent: number;
  @ApiProperty({ example: 10 }) referralDiscountPercent: number;

  static from({ referralDiscountPercent }: { referralDiscountPercent: number }): PricingResponse {
    const table = CURRENT_PRICE_TABLE;
    return {
      priceVersion: table.priceVersion,
      activationCents: table.activationCents,
      monthlyCents: table.monthlyCents,
      capCents: table.capCents,
      pixDiscountPercent: table.pixDiscountPercent,
      installments: {
        max: table.maxInstallments,
        interestFreeUpTo: table.interestFreeUpTo,
        interestPercent: table.interestBasisPoints / 100,
        interestBasisPoints: table.interestBasisPoints,
        interestFixedCents: table.interestFixedCents,
        minInstallmentCents: table.minInstallmentCents,
      },
      endDateMaxMonthsAfterEvent: table.endDateMaxMonthsAfterEvent,
      referralDiscountPercent,
    };
  }
}
