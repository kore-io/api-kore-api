const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export type OriginVerdict = 'allow' | 'reject';

/**
 * Proteção contra CSRF nas escritas. O cookie de sessão vai junto em qualquer
 * requisição do navegador, então uma escrita só é aceita se vier de uma origem
 * do app. Sem Origin e sem cookie de sessão é um cliente fora do navegador
 * (Bruno, webhook), que não carrega credencial ambiente: passa. Sem Origin e
 * com cookie, recusa: todo navegador atual manda Origin numa escrita.
 */
export function evaluateOrigin({
  method,
  origin,
  hasSessionCookie,
  allowedOrigins,
}: {
  method: string;
  origin: string | undefined;
  hasSessionCookie: boolean;
  allowedOrigins: readonly string[];
}): OriginVerdict {
  if (SAFE_METHODS.has(method.toUpperCase())) return 'allow';
  if (origin === undefined) return hasSessionCookie ? 'reject' : 'allow';
  return allowedOrigins.includes(origin) ? 'allow' : 'reject';
}
