import { createHmac, timingSafeEqual } from 'node:crypto';
import type { CookieOptions, Response } from 'express';
import type { GoogleLoginAttempt } from '../application/start-google-login.use-case';

export const GOOGLE_LOGIN_COOKIE = 'kore_oauth';
const TTL_MS = 10 * 60 * 1000;
// Só vai para as rotas do Google; Lax, porque a volta é uma navegação vinda do Google.
const OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/v1/auth/google',
};

/**
 * Guarda o state e o verifier do PKCE entre a ida e a volta do Google, num
 * cookie assinado com OAUTH_STATE_KEY (decisão 147). Nada vai para o banco.
 */
export class GoogleLoginCookie {
  private readonly key: Buffer;

  constructor({ keyBase64 }: { keyBase64: string }) {
    this.key = Buffer.from(keyBase64, 'base64');
  }

  set({
    response,
    attempt,
    now,
  }: {
    response: Response;
    attempt: GoogleLoginAttempt;
    now: Date;
  }): void {
    const payload = Buffer.from(
      JSON.stringify({ ...attempt, exp: now.getTime() + TTL_MS }),
    ).toString('base64url');
    response.cookie(GOOGLE_LOGIN_COOKIE, `${payload}.${this.sign({ payload })}`, {
      ...OPTIONS,
      maxAge: TTL_MS,
    });
  }

  clear({ response }: { response: Response }): void {
    response.clearCookie(GOOGLE_LOGIN_COOKIE, OPTIONS);
  }

  /** O pedido guardado, se a assinatura confere, não venceu e o state é o da volta. */
  read({
    value,
    state,
    now,
  }: {
    value: string | undefined;
    state: string | undefined;
    now: Date;
  }): GoogleLoginAttempt | null {
    if (!value || !state) return null;
    const [payload, signature] = value.split('.');
    if (!payload || !signature) return null;
    const expected = Buffer.from(this.sign({ payload }));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

    const attempt = JSON.parse(
      Buffer.from(payload, 'base64url').toString(),
    ) as GoogleLoginAttempt & {
      exp: number;
    };
    if (attempt.exp <= now.getTime() || attempt.state !== state) return null;
    return {
      state: attempt.state,
      codeVerifier: attempt.codeVerifier,
      origin: attempt.origin,
      returnPath: attempt.returnPath,
    };
  }

  private sign({ payload }: { payload: string }): string {
    return createHmac('sha256', this.key).update(payload).digest('base64url');
  }
}
