import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiErrorResponses, commonErrors } from '@/shared/http/api-error-responses.decorator';
import { GetMe } from '@/modules/access/application/sessions/get-me.use-case';
import { SetActiveProfile } from '@/modules/access/application/sessions/set-active-profile.use-case';
import type { AuthenticatedSession } from '@/modules/access/domain/authenticated-session';
import { ProfileNotOwnedErrorBody } from '@/modules/access/presentation/dto/access-error.dto';
import { toHttpError } from '@/modules/access/presentation/errors/access-http-errors';
import { CurrentSession } from '@/modules/access/presentation/http/decorators/current-session.decorator';
import {
  readLastProfileCookie,
  setLastProfileCookie,
} from '@/modules/access/presentation/http/cookies/last-profile-cookie';
import {
  MeResponse,
  SetActiveProfileBody,
  SetActiveProfileResponse,
} from '@/modules/access/presentation/dto/me.dto';

@ApiTags('me')
@Controller('me')
export class MeController {
  constructor(
    private readonly getMe: GetMe,
    private readonly setActiveProfile: SetActiveProfile,
  ) {}

  /** Quem está conectado, os perfis e os vínculos; a leitura também renova a sessão (RN08, RN14). */
  @Get()
  @ApiErrorResponses(...commonErrors({ session: true }))
  async me(
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: Request,
  ): Promise<MeResponse> {
    try {
      const me = await this.getMe.execute({
        session,
        lastProfileOnDevice: readLastProfileCookie({ request }),
      });
      return MeResponse.from({ me });
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Escolhe o perfil ativo da sessão, sem novo login (RN14, RN16 de Login). */
  @Post('active-profile')
  @HttpCode(HttpStatus.OK)
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    ProfileNotOwnedErrorBody,
  )
  async chooseProfile(
    @CurrentSession() session: AuthenticatedSession,
    @Body() body: SetActiveProfileBody,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SetActiveProfileResponse> {
    try {
      const result = await this.setActiveProfile.execute({ session, profile: body.profile });
      setLastProfileCookie({ response, profile: result.activeProfile });
      return result;
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
