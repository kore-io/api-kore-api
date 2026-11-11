import type { CookieOptions, Response } from 'express';

/** O limite dos navegadores; o fim da retenção do casamento chega com a F3 (decisão 207, item 6). */
const MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;

// HttpOnly, Secure e SameSite=Lax, só nas rotas do site (Site público RN08).
const BASE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/v1/sites',
};

/** Grava o cookie do grupo; não é renovado a cada leitura (RN08). */
export function setPartyCookie({
  response,
  name,
  value,
}: {
  response: Response;
  name: string;
  value: string;
}): void {
  response.cookie(name, value, { ...BASE_OPTIONS, maxAge: MAX_AGE_MS });
}

export function clearPartyCookie({ response, name }: { response: Response; name: string }): void {
  response.clearCookie(name, BASE_OPTIONS);
}
