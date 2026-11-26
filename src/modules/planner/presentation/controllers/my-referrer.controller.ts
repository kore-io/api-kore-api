import { Controller, Get } from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses, commonErrors } from '@/shared/http/api-error-responses.decorator';
import { GetMyReferrer } from '@/modules/access/application/profiles/planner-profile.use-cases';
import type { AuthenticatedSession } from '@/modules/access/domain/sessions/authenticated-session';
import { ProfileNotOwnedErrorBody } from '@/modules/access/presentation/dto/access-error.dto';
import { toHttpError } from '@/modules/access/presentation/errors/access-http-errors';
import { CurrentSession } from '@/modules/access/presentation/http/decorators/current-session.decorator';
import { PayoutDataUseCases } from '@/modules/referral/application/payout-data.use-cases';
import { ListReferrerCommissions } from '@/modules/planner/application/referrer-commissions.use-case';

class MyReferrerBalancesResponse {
  /** Disponível (sem o que está em repasse). */
  @ApiProperty({ example: 6742 }) availableCents: number;
  /** Aguardando liberação. */
  @ApiProperty({ example: 1740 }) pendingCents: number;
  /** Já recebido. */
  @ApiProperty({ example: 0 }) receivedCents: number;
  /** "(R$ 158,04 em repasse)". */
  @ApiProperty({ example: 0 }) inPayoutCents: number;
}

/** GET /v1/me/referrer (Link de indicação RN01 e RN02; Comissões, Contrato de API). */
export class MyReferrerResponse {
  @ApiProperty({ example: 'juliana-prado' }) referralCode: string;
  @ApiProperty({ example: 'https://kore.com.br/i/juliana-prado' }) link: string;
  /** Nulo com o desconto de indicação desligado. */
  @ApiProperty({ type: Number, nullable: true, example: 10 }) discountPercent: number | null;
  /** O percentual da comissão: a API devolve, a tela não mostra (decisão 230, D3). */
  @ApiProperty({ example: 20 }) ratePercent: number;
  /** Os saldos de Comissões (RN02), os mesmos de GET /v1/me/referrer/commissions. */
  @ApiProperty({ type: MyReferrerBalancesResponse }) balances: MyReferrerBalancesResponse;
  /** "***.982.247-**"; nulo antes do primeiro recebimento (Repasse RN02). */
  @ApiProperty({ type: String, nullable: true, example: '***.982.247-**' })
  taxIdMasked: string | null;
  /** A chave ativa mascarada; nula sem chave confirmada (Repasse RN03). */
  @ApiProperty({ type: String, nullable: true, example: 'jul***@pradoassessoria.com.br' })
  pixKeyMasked: string | null;
  /** CPF ou CNPJ e chave ativa: pode receber ("Cadastre seu CPF ou CNPJ e sua chave Pix…"). */
  @ApiProperty() payoutDataComplete: boolean;
}

/**
 * O resumo da pessoa indicadora (decisão 275: o Contrato de API de Comissões
 * vale): o link, o desconto, o percentual, os saldos e os dados para receber
 * mascarados. Fica no planner porque junta o perfil (access), as comissões
 * (planner) e os dados para receber (referral).
 */
@ApiTags('planner')
@Controller('me/referrer')
export class MyReferrerController {
  constructor(
    private readonly getReferrer: GetMyReferrer,
    private readonly commissions: ListReferrerCommissions,
    private readonly payoutData: PayoutDataUseCases,
  ) {}

  @Get()
  @ApiErrorResponses(...commonErrors({ session: true }), ProfileNotOwnedErrorBody)
  async referrer(@CurrentSession() session: AuthenticatedSession): Promise<MyReferrerResponse> {
    try {
      const referrer = await this.getReferrer.execute({ userId: session.userId });
      const {
        balances: { availableCents, pendingCents, receivedCents, inPayoutCents },
      } = await this.commissions.execute({ userId: session.userId });
      // Os dados para receber, mascarados (Repasse, Contrato; decisão 244(2)).
      const payout = await this.payoutData.summary();
      return {
        ...referrer,
        balances: { availableCents, pendingCents, receivedCents, inPayoutCents },
        taxIdMasked: payout?.taxIdMasked ?? null,
        pixKeyMasked: payout?.pixKeyMasked ?? null,
        payoutDataComplete: payout?.payoutDataComplete ?? false,
      };
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
