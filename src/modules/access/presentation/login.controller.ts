import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../../shared/http/public.decorator';
import { AuthRateLimit } from '../../../shared/rate-limit/rate-limits';
import { RequestLoginChallenge } from '../application/request-login-challenge.use-case';
import {
  VerifyLoginChallenge,
  type LoginCredentials,
} from '../application/verify-login-challenge.use-case';
import { invalidVerifyBody, toHttpError } from './access-http-errors';
import {
  RequestLoginChallengeBody,
  RequestLoginChallengeResponse,
  VerifyLoginChallengeBody,
  VerifyLoginChallengeResponse,
} from './login.dto';
import { setSessionCookie } from './session-cookie';

@ApiTags('auth')
@Controller('auth/login-challenges')
@Public()
@AuthRateLimit()
export class LoginController {
  constructor(
    private readonly requestChallenge: RequestLoginChallenge,
    private readonly verifyChallenge: VerifyLoginChallenge,
  ) {}

  /** Pede o código e o botão de acesso por e-mail (RN01 a RN04, RN06). */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async request(
    @Body() body: RequestLoginChallengeBody,
    @Req() request: Request,
  ): Promise<RequestLoginChallengeResponse> {
    try {
      const result = await this.requestChallenge.execute({
        email: body.email,
        origin: body.origin ?? 'none',
        originRef: body.originRef ?? null,
        requestIp: request.ip ?? null,
        now: new Date(),
      });
      return { email: result.email, resendAvailableAt: result.resendAvailableAt.toISOString() };
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Confirma pelo código ou pelo botão e abre a sessão (RN01, RN02, RN05, RN06, RN08, RN11). */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verify(
    @Body() body: VerifyLoginChallengeBody,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<VerifyLoginChallengeResponse> {
    try {
      const { session, ...login } = await this.verifyChallenge.execute({
        credentials: credentialsFrom({ body }),
        ip: request.ip ?? null,
        userAgent: request.headers['user-agent'],
        now: new Date(),
      });
      setSessionCookie({ response, token: session.token, expiresAt: session.expiresAt });
      return login;
    } catch (error) {
      throw toHttpError(error);
    }
  }
}

function credentialsFrom({ body }: { body: VerifyLoginChallengeBody }): LoginCredentials {
  const { email, code, token } = body;
  if (token !== undefined && email === undefined && code === undefined) return { token };
  if (email !== undefined && code !== undefined && token === undefined) return { email, code };
  throw invalidVerifyBody();
}
