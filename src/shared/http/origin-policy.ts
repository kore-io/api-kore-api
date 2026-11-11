const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export type OriginVerdict = 'allow' | 'reject';

/**
 * As origens aceitas numa rota (Site público RN07; decisão 207, item 4): nas
 * rotas do app, só as do app; nas rotas @SiteRoute(), também a do site. Assim
 * um script em kore.com.br não lê nem escreve nas rotas do app com a sessão
 * do casal, que vai junto porque os dois hosts são o mesmo site.
 */
export function originsFor({
  isSiteRoute,
  appOrigins,
  siteOrigin,
}: {
  isSiteRoute: boolean;
  appOrigins: readonly string[];
  siteOrigin: string | null;
}): readonly string[] {
  return isSiteRoute && siteOrigin ? [...appOrigins, siteOrigin] : appOrigins;
}

/**
 * Proteção contra CSRF nas escritas. As credenciais ambientes (a sessão, o
 * cookie do grupo e o da prévia) vão junto em qualquer requisição do
 * navegador, então uma escrita só é aceita se vier de uma origem da rota. Sem
 * Origin e sem credencial é um cliente fora do navegador (Bruno, webhook):
 * passa. Sem Origin e com credencial, recusa: todo navegador atual manda Origin
 * numa escrita.
 */
export function evaluateOrigin({
  method,
  origin,
  hasCredential,
  allowedOrigins,
}: {
  method: string;
  origin: string | undefined;
  hasCredential: boolean;
  allowedOrigins: readonly string[];
}): OriginVerdict {
  if (SAFE_METHODS.has(method.toUpperCase())) return 'allow';
  if (origin === undefined) return hasCredential ? 'reject' : 'allow';
  return allowedOrigins.includes(origin) ? 'allow' : 'reject';
}
