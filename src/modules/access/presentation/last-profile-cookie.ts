import type { Request, Response } from 'express';
import type { ProfileKind } from '../domain/authenticated-session';
import { PROFILE_KINDS } from '../domain/profiles';

/**
 * O último perfil escolhido neste aparelho (RN14 de Login; decisão 177, item 1):
 * a API não conhece o aparelho, então guarda num cookie próprio, lido só pelo
 * GET /v1/me. Não é credencial.
 */
export const LAST_PROFILE_COOKIE = 'kore_last_profile';
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const COOKIE_PATH = '/v1/me';

export function setLastProfileCookie({
  response,
  profile,
}: {
  response: Response;
  profile: ProfileKind;
}): void {
  response.cookie(LAST_PROFILE_COOKIE, profile, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: COOKIE_PATH,
    maxAge: ONE_YEAR_MS,
  });
}

export function readLastProfileCookie({ request }: { request: Request }): ProfileKind | null {
  const value = (request.cookies as Record<string, string | undefined>)[LAST_PROFILE_COOKIE];
  return PROFILE_KINDS.find((profile) => profile === value) ?? null;
}
