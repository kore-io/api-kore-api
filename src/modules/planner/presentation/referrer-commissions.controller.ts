import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import {
  ApiErrorResponses,
  commonErrors,
} from '../../../shared/http/api-error-responses.decorator';
import type { AuthenticatedSession } from '../../access/domain/authenticated-session';
import { ProfileNotOwnedErrorBody } from '../../access/presentation/access-error.dto';
import { toHttpError } from '../../access/presentation/access-http-errors';
import { CurrentSession } from '../../access/presentation/current-session.decorator';
import { ListReferrerCommissions } from '../application/referrer-commissions.use-case';
import type { CommissionRow, WeddingCommissions } from '../domain/commissions';

const STATUSES = ['pending', 'available', 'paid', 'reversed', 'blocked', 'held'] as const;

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

class CommissionItemResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  /** Nulo quando a linha não abre (ela não colabora no casamento) ou o casamento foi apagado. */
  @ApiProperty({ type: String, nullable: true }) weddingId: string | null;
  /** Nulo no casamento apagado: o app mostra "Casamento apagado" (RN07; B5-8). */
  @ApiProperty({ type: [String], nullable: true, example: ['Ana', 'Marcos'] })
  partnerNames: [string, string] | null;
  weddingPurged: boolean;
  clickable: boolean;
  /** Pagamento de origem: Publicação · Extensão. */
  @ApiProperty({ enum: ['publication', 'extension'] }) paymentKind: 'publication' | 'extension';
  /** Valor pago (sem juros). */
  @ApiProperty({ example: 33710 }) baseAmountCents: number;
  @ApiProperty({ example: 6742 }) amountCents: number;
  /** Devolvido, mas a tela não o mostra (decisão 230, D3). */
  @ApiProperty({ example: 20 }) ratePercent: number;
  @ApiProperty({ enum: STATUSES }) status: CommissionRow['status'];
  /** "Libera em 09/09". */
  @ApiProperty({ format: 'date-time' }) availableAt: string;
  /** "Paga em dd/mm". */
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) paidAt: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}

class WeddingCommissionsResponse {
  @ApiProperty({ type: String, nullable: true }) weddingId: string | null;
  @ApiProperty({ type: [String], nullable: true, example: ['Ana', 'Marcos'] })
  partnerNames: [string, string] | null;
  weddingPurged: boolean;
  clickable: boolean;
  @ApiProperty({ example: 6742 }) availableCents: number;
  @ApiProperty({ example: 1740 }) pendingCents: number;
  /** "Libera em 09/09" · "libera em 02/10 e em 10/10"; vazio, "nada a liberar agora". */
  @ApiProperty({ type: [String], format: 'date-time' }) releaseDates: string[];
}

export class ReferrerCommissionsResponse {
  @ApiProperty({ type: CommissionBalancesResponse }) balances: CommissionBalancesResponse;
  @ApiProperty({ type: [CommissionItemResponse] }) items: CommissionItemResponse[];
  @ApiProperty({ type: [WeddingCommissionsResponse] }) byWedding: WeddingCommissionsResponse[];
}

const openable = (row: { clickable: boolean; weddingId: string }) =>
  row.clickable ? row.weddingId : null;

@ApiTags('planner')
@Controller('me/referrer/commissions')
export class ReferrerCommissionsController {
  constructor(private readonly listCommissions: ListReferrerCommissions) {}

  /** A tela Comissões (Comissões do indicador RN02, RN07 e RN10). */
  @Get()
  @ApiOkResponse({ type: ReferrerCommissionsResponse })
  @ApiErrorResponses(...commonErrors({ session: true }), ProfileNotOwnedErrorBody)
  async list(
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<ReferrerCommissionsResponse> {
    try {
      const view = await this.listCommissions.execute({ userId: session.userId });
      return {
        balances: view.balances,
        items: view.items.map((row: CommissionRow) => ({
          ...row,
          weddingId: openable(row),
          availableAt: row.availableAt.toISOString(),
          paidAt: row.paidAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
          payoutId: undefined,
        })),
        byWedding: view.byWedding.map((row: WeddingCommissions) => ({
          ...row,
          weddingId: openable(row),
          releaseDates: row.releaseDates.map((date) => date.toISOString()),
        })),
      };
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
