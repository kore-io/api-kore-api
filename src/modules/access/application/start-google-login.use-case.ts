import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { LoginOrigin } from '../domain/login-next-step';
import { safeReturnPath } from '../domain/return-path';
import {
  GOOGLE_IDENTITY_PROVIDER,
  type GoogleIdentityProvider,
} from './ports/google-identity-provider.port';

/** O que fica guardado (no cookie assinado) entre a ida e a volta do Google. */
export interface GoogleLoginAttempt {
  state: string;
  codeVerifier: string;
  origin: LoginOrigin;
  returnPath: string | null;
}

/**
 * Começa o login pelo Google (RN01, RN06 e RN10 de Login; decisões 135 e 147):
 * gera o state e o PKCE e devolve o endereço do Google. O token do convite não
 * entra (decisão 142): o app o guarda e volta ao convite.
 */
@Injectable()
export class StartGoogleLogin {
  constructor(
    @Inject(GOOGLE_IDENTITY_PROVIDER) private readonly provider: GoogleIdentityProvider,
  ) {}

  execute({ origin, next }: { origin: LoginOrigin; next: string | undefined }): {
    authorizationUrl: string;
    attempt: GoogleLoginAttempt;
  } {
    const state = randomBytes(32).toString('base64url');
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    return {
      authorizationUrl: this.provider.authorizationUrl({ state, codeChallenge }),
      attempt: { state, codeVerifier, origin, returnPath: safeReturnPath({ next }) },
    };
  }
}
