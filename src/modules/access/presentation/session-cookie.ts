import type { CookieOptions, Response } from 'express';

export const SESSION_COOKIE = 'kore_session';

// RN08 de Login e ADR de login sem senha: HttpOnly, Secure e SameSite=Lax
// (Lax para o cookie ir junto quando a pessoa chega pelo link do e-mail).
const BASE_OPTIONS: CookieOptions = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' };

export function setSessionCookie({
  response,
  token,
  expiresAt,
}: {
  response: Response;
  token: string;
  expiresAt: Date;
}): void {
  response.cookie(SESSION_COOKIE, token, { ...BASE_OPTIONS, expires: expiresAt });
}

export function clearSessionCookie({ response }: { response: Response }): void {
  response.clearCookie(SESSION_COOKIE, BASE_OPTIONS);
}
