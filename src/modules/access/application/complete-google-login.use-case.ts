import { Inject, Injectable } from '@nestjs/common';
import { GoogleEmailUnverifiedError } from '../domain/access.errors';
import { CompleteLogin, type CompletedLogin } from './complete-login.use-case';
import {
  GOOGLE_IDENTITY_PROVIDER,
  type GoogleIdentityProvider,
} from './ports/google-identity-provider.port';
import type { GoogleLoginAttempt } from './start-google-login.use-case';

/**
 * Volta do Google: troca o código (com o verifier do PKCE), exige e-mail
 * verificado e entra pela mesma conta do e-mail (RN07), como o login por código.
 */
@Injectable()
export class CompleteGoogleLogin {
  constructor(
    @Inject(GOOGLE_IDENTITY_PROVIDER) private readonly provider: GoogleIdentityProvider,
    private readonly completeLogin: CompleteLogin,
  ) {}

  async execute({
    code,
    attempt,
    ip,
    userAgent,
    now,
  }: {
    code: string;
    attempt: GoogleLoginAttempt;
    ip: string | null;
    userAgent?: string;
    now: Date;
  }): Promise<CompletedLogin> {
    const identity = await this.provider.exchangeCode({ code, codeVerifier: attempt.codeVerifier });
    if (!identity.emailVerified) throw new GoogleEmailUnverifiedError();
    return this.completeLogin.execute({
      email: identity.email.toLowerCase(),
      method: 'google',
      providerSubject: identity.subject,
      origin: attempt.origin,
      ip,
      userAgent,
      now,
    });
  }
}
