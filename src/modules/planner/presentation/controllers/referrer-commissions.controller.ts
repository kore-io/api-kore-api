import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiProperty,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiErrorResponses, commonErrors } from '@/shared/http/api-error-responses.decorator';
import type { AuthenticatedSession } from '@/modules/access/domain/sessions/authenticated-session';
import { ProfileNotOwnedErrorBody } from '@/modules/access/presentation/dto/access-error.dto';
import { toHttpError } from '@/modules/access/presentation/errors/access-http-errors';
import { CurrentSession } from '@/modules/access/presentation/http/decorators/current-session.decorator';
import { ListReferrerCommissions } from '@/modules/planner/application/referrer-commissions.use-case';
import {
  commissionCoupleNames,
  type CommissionPaymentLine,
  type CommissionRow,
  type WeddingCommissions,
} from '@/modules/planner/domain/commissions';

const STATUSES = ['pending', 'available', 'paid', 'reversed', 'blocked', 'held'] as const;
const BLOCK_REASONS = ['self_referral', 'referrer_blocked', 'admin', 'wedding_blocked'] as const;
const PAYOUT_STATUSES = ['requested', 'held', 'processing', 'paid', 'rejected'] as const;

/** A aba e a página (Contrato de API: `view=payment|wedding&page=`). */
export class ReferrerCommissionsQuery {
  @ApiProperty({ enum: ['payment', 'wedding'], required: false, default: 'payment' })
  @IsOptional()
  @IsIn(['payment', 'wedding'])
  view?: 'payment' | 'wedding';

  @ApiProperty({ required: false, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page?: number;
}

class CommissionBalancesResponse {
  /** Disponível (sem o que está em repasse). */
  @ApiProperty({ example: 6742 }) availableCents: number;
  /** Aguardando liberação. */
  @ApiProperty({ example: 1740 }) pendingCents: number;
  /** Já recebido. */
  @ApiProperty({ example: 0 }) receivedCents: number;
  /** "(R$ 158,04 em repasse)". */
  @ApiProperty({ example: 0 }) inPayoutCents: number;
}

/** Uma comissão, na aba Por pagamento (RN07). */
class CommissionLineResponse {
  @ApiProperty({ enum: ['commission'] }) kind: 'commission';
  @ApiProperty({ format: 'uuid' }) commissionId: string;
  /** Nulo quando a linha não abre (ela não colabora no casamento) ou o casamento foi apagado. */
  @ApiProperty({ type: String, nullable: true }) weddingId: string | null;
  /** "Ana & Marcos"; nulo no casamento apagado: o app mostra "Casamento apagado" (RN07; B5-8). */
  @ApiProperty({ type: String, nullable: true, example: 'Ana & Marcos' })
  coupleNames: string | null;
  /** O casamento foi expurgado (a lápide): a linha fica e não abre. */
  @ApiProperty() weddingPurged: boolean;
  /** A linha abre o casamento (ela colabora nele). */
  @ApiProperty() clickable: boolean;
  /** Pagamento de origem: Publicação · Extensão. */
  @ApiProperty({ enum: ['publication', 'extension'] }) paymentKind: 'publication' | 'extension';
  /** Valor pago (sem juros). */
  @ApiProperty({ example: 33710 }) baseAmountCents: number;
  @ApiProperty({ example: 6742 }) amountCents: number;
  /** Devolvido, mas a tela não o mostra (decisão 230, D3). */
  @ApiProperty({ example: 20 }) ratePercent: number;
  @ApiProperty({ enum: STATUSES }) status: CommissionRow['status'];
  /** O motivo da Bloqueada; a tela mostra só a legenda, sem o motivo (RN07). */
  @ApiProperty({ enum: BLOCK_REASONS, nullable: true }) blockReason: CommissionRow['blockReason'];
  /** "Libera em 09/09". */
  @ApiProperty({ format: 'date-time' }) availableAt: string;
  /** "Paga em dd/mm". */
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) paidAt: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}

/** Um ajuste, em linha negativa e sem selo, na aba Por pagamento (RN07). */
class AdjustmentLineResponse {
  @ApiProperty({ enum: ['adjustment'] }) kind: 'adjustment';
  @ApiProperty({ format: 'uuid' }) adjustmentId: string;
  @ApiProperty({ example: -6742 }) amountCents: number;
  /** refund · chargeback (o estorno da comissão já paga) · manual (o do Admin). */
  @ApiProperty({ enum: ['refund', 'chargeback', 'manual'] }) reason: string;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  /** O repasse em que o ajuste entrou; nulo: "Desconta no próximo repasse". */
  @ApiProperty({ enum: PAYOUT_STATUSES, nullable: true })
  payoutStatus: (typeof PAYOUT_STATUSES)[number] | null;
}

/** A soma por casal, na aba Por casamento (RN07). */
class WeddingCommissionsResponse {
  @ApiProperty({ type: String, nullable: true }) weddingId: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'Ana & Marcos' })
  coupleNames: string | null;
  @ApiProperty() weddingPurged: boolean;
  @ApiProperty() clickable: boolean;
  @ApiProperty({ example: 6742 }) availableCents: number;
  @ApiProperty({ example: 1740 }) pendingCents: number;
  /** "Libera em 09/09" · "libera em 02/10 e em 10/10"; vazio, "nada a liberar agora". */
  @ApiProperty({ type: [String], format: 'date-time' }) releaseDates: string[];
}

@ApiExtraModels(CommissionLineResponse, AdjustmentLineResponse, WeddingCommissionsResponse)
export class ReferrerCommissionsResponse {
  @ApiProperty({ type: CommissionBalancesResponse }) balances: CommissionBalancesResponse;
  @ApiProperty({ enum: ['payment', 'wedding'] }) view: 'payment' | 'wedding';
  /** Por pagamento: comissões e ajustes; por casamento: as somas por casal. */
  @ApiProperty({
    type: 'array',
    items: {
      oneOf: [
        { $ref: getSchemaPath(CommissionLineResponse) },
        { $ref: getSchemaPath(AdjustmentLineResponse) },
        { $ref: getSchemaPath(WeddingCommissionsResponse) },
      ],
    },
  })
  items: (CommissionLineResponse | AdjustmentLineResponse | WeddingCommissionsResponse)[];
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 50 }) pageSize: number;
  @ApiProperty({ example: 2 }) total: number;
}

const openable = (row: { clickable: boolean; weddingId: string }) =>
  row.clickable ? row.weddingId : null;

function paymentLine(line: CommissionPaymentLine): CommissionLineResponse | AdjustmentLineResponse {
  if (line.kind === 'adjustment')
    return {
      kind: 'adjustment',
      adjustmentId: line.adjustment.id,
      amountCents: line.adjustment.amountCents,
      reason: line.adjustment.reason,
      createdAt: line.adjustment.createdAt.toISOString(),
      payoutStatus: line.adjustment.payoutStatus,
    };
  const row = line.commission;
  return {
    kind: 'commission',
    commissionId: row.id,
    weddingId: openable(row),
    coupleNames: commissionCoupleNames(row.partnerNames),
    weddingPurged: row.weddingPurged,
    clickable: row.clickable,
    paymentKind: row.paymentKind,
    baseAmountCents: row.baseAmountCents,
    amountCents: row.amountCents,
    ratePercent: row.ratePercent,
    status: row.status,
    blockReason: row.blockReason,
    availableAt: row.availableAt.toISOString(),
    paidAt: row.paidAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function weddingLine(row: WeddingCommissions): WeddingCommissionsResponse {
  return {
    weddingId: openable(row),
    coupleNames: commissionCoupleNames(row.partnerNames),
    weddingPurged: row.weddingPurged,
    clickable: row.clickable,
    availableCents: row.availableCents,
    pendingCents: row.pendingCents,
    releaseDates: row.releaseDates.map((date) => date.toISOString()),
  };
}

@ApiTags('planner')
@Controller('me/referrer/commissions')
export class ReferrerCommissionsController {
  constructor(private readonly listCommissions: ListReferrerCommissions) {}

  /** A tela Comissões (Comissões do indicador RN02, RN07 e RN10; Contrato de API). */
  @Get()
  @ApiOkResponse({ type: ReferrerCommissionsResponse })
  @ApiErrorResponses(...commonErrors({ session: true, validated: true }), ProfileNotOwnedErrorBody)
  async list(
    @CurrentSession() session: AuthenticatedSession,
    @Query() query: ReferrerCommissionsQuery,
  ): Promise<ReferrerCommissionsResponse> {
    try {
      const view = await this.listCommissions.execute({
        userId: session.userId,
        view: query.view ?? 'payment',
        page: query.page ?? 1,
      });
      const { balances, page, pageSize, total } = view;
      return {
        balances,
        view: view.view,
        items: view.view === 'wedding' ? view.items.map(weddingLine) : view.items.map(paymentLine),
        page,
        pageSize,
        total,
      };
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
