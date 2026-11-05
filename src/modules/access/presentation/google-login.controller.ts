import {
  Controller,
  Get,
  Inject,
  Logger,
  NotFoundException,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AppConfigService } from '../../../shared/config/app-config.service';
import { Public } from '../../../shared/http/public.decorator';
import { AuthRateLimit } from '../../../shared/rate-limit/rate-limits';
import { CompleteGoogleLogin } from '../application/complete-google-login.use-case';
import { StartGoogleLogin } from '../application/start-google-login.use-case';
import { GoogleEmailUnverifiedError, UserBlockedError } from '../domain/access.errors';
import { escapeHtml } from '../infrastructure/emails/email-layout';
import { DevGoogleProvider } from '../infrastructure/dev-google.provider';
import { DevGoogleQuery, StartGoogleLoginQuery } from './google-login.dto';
import { GOOGLE_LOGIN_COOKIE, GoogleLoginCookie } from './google-login-cookie';
import { setSessionCookie } from './session-cookie';

/** Telas do app para onde a volta do Google leva (decisão 147). */
const APP_GOOGLE_RETURN_PATH = '/entrar/google';
const APP_SIGN_IN_PATH = '/entrar';
const MAX_CALLBACK_PARAM_LENGTH = 2000;

const logger = new Logger('GoogleLogin');

/**
 * Parâmetro da volta do Google, lido direto da query: o Google pode acrescentar
 * parâmetros (iss, RFC 9207; scope, authuser…), e o DTO com
 * forbidNonWhitelisted derrubaria o login. Só code, state e error importam.
 */
function callbackParam({ request, name }: { request: Request; name: string }): string | undefined {
  const value = (request.query as Record<string, unknown>)[name];
  return typeof value === 'string' && value.length <= MAX_CALLBACK_PARAM_LENGTH ? value : undefined;
}

@ApiTags('auth')
@Controller('auth/google')
@Public()
export class GoogleLoginController {
  private readonly appUrl: string;
  private readonly devProvider: boolean;

  constructor(
    private readonly startLogin: StartGoogleLogin,
    private readonly completeLogin: CompleteGoogleLogin,
    @Inject(GoogleLoginCookie) private readonly attemptCookie: GoogleLoginCookie,
    config: AppConfigService,
  ) {
    this.appUrl = config.get({ key: 'APP_URL' });
    this.devProvider = config.get({ key: 'GOOGLE_PROVIDER' }) === 'dev';
  }

  /** Vai para o Google, guardando o state e o PKCE num cookie assinado. */
  @Get()
  @ApiResponse({
    status: 302,
    description: 'Vai para o Google (ou para o provedor de desenvolvimento).',
  })
  start(@Query() query: StartGoogleLoginQuery, @Res() response: Response): void {
    const { authorizationUrl, attempt } = this.startLogin.execute({
      origin: query.origin ?? 'none',
      next: query.next,
    });
    this.attemptCookie.set({ response, attempt, now: new Date() });
    response.redirect(302, authorizationUrl);
  }

  /** Volta do Google: abre a sessão e leva ao próximo passo (RN06 a RN08, RN10, RN11). */
  @Get('callback')
  @ApiResponse({
    status: 302,
    description:
      'Sucesso: APP_URL/entrar/google?step=&next=, com o cookie de sessão. Erro: APP_URL/entrar?error=google_unverified|blocked|google_failed (decisão 147).',
  })
  @AuthRateLimit()
  async callback(@Req() request: Request, @Res() response: Response): Promise<void> {
    const now = new Date();
    const code = callbackParam({ request, name: 'code' });
    const state = callbackParam({ request, name: 'state' });
    const cookies = request.cookies as Record<string, string | undefined>;
    const attempt = this.attemptCookie.read({ value: cookies[GOOGLE_LOGIN_COOKIE], state, now });
    this.attemptCookie.clear({ response });
    if (!attempt || !code || callbackParam({ request, name: 'error' })) {
      return this.redirectToSignIn({ response, error: 'google_failed' });
    }

    try {
      const { session, next } = await this.completeLogin.execute({
        code,
        attempt,
        ip: request.ip ?? null,
        userAgent: request.headers['user-agent'],
        now,
      });
      setSessionCookie({ response, token: session.token, expiresAt: session.expiresAt });
      const target = new URL(APP_GOOGLE_RETURN_PATH, this.appUrl);
      target.searchParams.set('step', next);
      if (attempt.returnPath) target.searchParams.set('next', attempt.returnPath);
      response.redirect(302, target.toString());
    } catch (error) {
      if (error instanceof GoogleEmailUnverifiedError) {
        return this.redirectToSignIn({ response, error: 'google_unverified' });
      }
      if (error instanceof UserBlockedError) {
        return this.redirectToSignIn({ response, error: 'blocked' });
      }
      // Falha do Google (token endpoint, id_token, assinatura): volta a Entrar.
      // No log, só o tipo do erro: a mensagem pode trazer o e-mail.
      logger.warn(
        `Login pelo Google falhou: ${error instanceof Error ? error.name : 'UnknownError'}`,
      );
      return this.redirectToSignIn({ response, error: 'google_failed' });
    }
  }

  /**
   * Provedor de desenvolvimento (só GOOGLE_PROVIDER=dev): um formulário mínimo
   * pede o e-mail e volta ao callback como o Google voltaria. Ferramenta de
   * desenvolvimento, não é tela do produto.
   */
  @Get('dev')
  @ApiExcludeEndpoint()
  dev(@Query() query: DevGoogleQuery, @Res() response: Response): void {
    if (!this.devProvider) throw new NotFoundException();
    if (!query.email) {
      response
        .type('html')
        .send(
          `<!doctype html><html lang="pt-BR"><body><form method="get"><p>Google de desenvolvimento</p>` +
            `<input type="hidden" name="state" value="${escapeHtml({ text: query.state })}">` +
            `<label>E-mail <input name="email" type="email" required></label> ` +
            `<button>Entrar</button></form></body></html>`,
        );
      return;
    }
    const code = DevGoogleProvider.codeFor({
      email: query.email,
      verified: query.verified !== 'false',
    });
    response.redirect(
      302,
      `callback?${new URLSearchParams({ code, state: query.state }).toString()}`,
    );
  }

  private redirectToSignIn({ response, error }: { response: Response; error: string }): void {
    const target = new URL(APP_SIGN_IN_PATH, this.appUrl);
    target.searchParams.set('error', error);
    response.redirect(302, target.toString());
  }
}
