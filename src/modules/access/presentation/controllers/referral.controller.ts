import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses, commonErrors } from '@/shared/http/api-error-responses.decorator';
import { Public } from '@/shared/http/public.decorator';
import { GetReferral } from '@/modules/access/application/profiles/get-referral.use-case';
import { ReferralNotFoundErrorBody } from '@/modules/access/presentation/dto/access-error.dto';
import { toHttpError } from '@/modules/access/presentation/errors/access-http-errors';
import { ReferralResponse } from '@/modules/access/presentation/dto/referral.dto';

@ApiTags('referrals')
@Controller('referrals')
@Public()
export class ReferralController {
  constructor(private readonly getReferral: GetReferral) {}

  /** Indicador do link de indicação, para o destaque do cadastro (RN08, RN09 de Cadastro). */
  @Get(':code')
  @ApiErrorResponses(...commonErrors({}), ReferralNotFoundErrorBody)
  async referral(@Param('code') code: string): Promise<ReferralResponse> {
    try {
      return ReferralResponse.from({ referral: await this.getReferral.execute({ code }) });
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
