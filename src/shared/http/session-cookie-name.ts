/** Nome do cookie da sessão: lido pelo SessionGuard e pela proteção contra CSRF. */
export const SESSION_COOKIE = 'kore_session';

/** Cookie do grupo identificado, um por casamento (Site público RN06 e RN08). */
export const PARTY_COOKIE_PREFIX = 'kore_party_';

/** Cookie da pré-visualização, um por casamento (Pré-visualização RN03). */
export const SITE_PREVIEW_COOKIE_PREFIX = 'kore_site_preview_';

/**
 * Se a requisição traz alguma credencial ambiente do navegador: a sessão, o
 * cookie de um grupo ou o da prévia (Site público RN07).
 */
export function hasCredentialCookie({
  cookies,
}: {
  cookies: Record<string, string | undefined> | undefined;
}): boolean {
  return Object.entries(cookies ?? {}).some(
    ([name, value]) =>
      Boolean(value) &&
      (name === SESSION_COOKIE ||
        name.startsWith(PARTY_COOKIE_PREFIX) ||
        name.startsWith(SITE_PREVIEW_COOKIE_PREFIX)),
  );
}
