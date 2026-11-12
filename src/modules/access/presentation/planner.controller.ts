import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  ApiErrorResponses,
  commonErrors,
} from '../../../shared/http/api-error-responses.decorator';
import {
  CreatePlannerProfile,
  GetMyReferrer,
  GetPlannerProfile,
  UpdatePlannerProfile,
} from '../application/planner-profile.use-cases';
import type { AuthenticatedSession } from '../domain/authenticated-session';
import {
  PlannerNotFoundErrorBody,
  PlannerProfileExistsErrorBody,
  PlannerSignupDisabledErrorBody,
  ProfileNotOwnedErrorBody,
  SellerCannotBePlannerErrorBody,
  TermsVersionOutdatedErrorBody,
} from './access-error.dto';
import { toHttpError } from './access-http-errors';
import { CurrentSession } from './current-session.decorator';
import { setLastProfileCookie } from './last-profile-cookie';
import {
  CreatePlannerProfileBody,
  CreatePlannerProfileResponse,
  MyReferrerResponse,
  PlannerProfileResponse,
  UpdatePlannerProfileBody,
} from './planner.dto';

/** Perfil do cerimonialista e o link de indicação (Cadastro e perfil; Link de indicação). */
@ApiTags('me')
@Controller('me')
export class PlannerController {
  constructor(
    private readonly createProfile: CreatePlannerProfile,
    private readonly getProfile: GetPlannerProfile,
    private readonly updateProfile: UpdatePlannerProfile,
    private readonly getReferrer: GetMyReferrer,
  ) {}

  /** Cria o perfil de cerimonialista na conta da sessão (RN02 a RN05). */
  @Post('planner')
  @HttpCode(HttpStatus.CREATED)
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    PlannerSignupDisabledErrorBody,
    PlannerProfileExistsErrorBody,
    SellerCannotBePlannerErrorBody,
    TermsVersionOutdatedErrorBody,
  )
  async create(
    @CurrentSession() session: AuthenticatedSession,
    @Body() body: CreatePlannerProfileBody,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CreatePlannerProfileResponse> {
    try {
      const { termsVersion, ...input } = body;
      const created = await this.createProfile.execute({
        session,
        input,
        termsVersion,
        now: new Date(),
      });
      // RN05: a sessão passa ao perfil de cerimonialista, e o aparelho lembra.
      setLastProfileCookie({ response, profile: 'planner' });
      return created;
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Meu perfil (RN09 e RN10). */
  @Get('planner')
  @ApiErrorResponses(...commonErrors({ session: true }), PlannerNotFoundErrorBody)
  async profile(@CurrentSession() session: AuthenticatedSession): Promise<PlannerProfileResponse> {
    try {
      return PlannerProfileResponse.from({
        view: await this.getProfile.execute({ userId: session.userId }),
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Salva o Meu perfil, com as validações do cadastro (RN09 e RN10). */
  @Patch('planner')
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    PlannerNotFoundErrorBody,
    TermsVersionOutdatedErrorBody,
  )
  async update(
    @CurrentSession() session: AuthenticatedSession,
    @Body() body: UpdatePlannerProfileBody,
  ): Promise<PlannerProfileResponse> {
    try {
      const { termsVersion, ...input } = body;
      return PlannerProfileResponse.from({
        view: await this.updateProfile.execute({
          userId: session.userId,
          input,
          termsVersion: termsVersion ?? null,
          now: new Date(),
        }),
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** O link de indicação e o desconto do casal (Link de indicação RN01 e RN02). */
  @Get('referrer')
  @ApiErrorResponses(...commonErrors({ session: true }), ProfileNotOwnedErrorBody)
  async referrer(@CurrentSession() session: AuthenticatedSession): Promise<MyReferrerResponse> {
    try {
      return await this.getReferrer.execute({ userId: session.userId });
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
