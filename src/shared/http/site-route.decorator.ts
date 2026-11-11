import { SetMetadata } from '@nestjs/common';

export const IS_SITE_ROUTE = 'isSiteRoute';

/**
 * Rota do site do casal (Site público RN07; decisão 207, item 4): as de
 * `/v1/sites/*`, `/v1/public/*` e do simulador. Só nelas a origem do site
 * (SITE_URL) recebe os cabeçalhos de CORS e pode escrever; nas outras, só a
 * origem do app. A regra olha este metadado, não o prefixo do caminho.
 */
export const SiteRoute = (): MethodDecorator & ClassDecorator => SetMetadata(IS_SITE_ROUTE, true);
