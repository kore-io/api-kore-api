import { addWeddingWriteErrors } from './wedding-write-errors';
import { HttpAdapterHost } from '@nestjs/core';
import { NoStoreGoneFilter } from './no-store-gone.filter';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import type { CorsOptionsDelegate } from '@nestjs/common/interfaces/external/cors-options.interface';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { Request } from 'express';
import { OPENAPI_CONSTANT_SCHEMAS } from '../../openapi-constants';
import { originsFor } from './origin-policy';
import { SiteRouteRegistry } from './site-routes.registry';
import { validationExceptionFactory } from './validation-errors';

export const API_DOCS_PATH = 'docs';

/**
 * Comportamento HTTP global, aplicado igual no main e nos testes e2e, para o
 * teste exercitar a mesma pilha que roda em produção.
 */
export function configureApp({
  app,
  enableDocs,
  allowedOrigins,
  siteOrigin,
  trustProxyHops,
}: {
  app: INestApplication;
  enableDocs: boolean;
  allowedOrigins: readonly string[];
  /** A origem do site do casal (SITE_URL); nula onde não há site (testes, OpenAPI). */
  siteOrigin: string | null;
  trustProxyHops: number;
}): INestApplication {
  // Atrás de proxy (Railway), o IP do cliente vem no X-Forwarded-For; só os
  // saltos confiáveis contam, para o cliente não forjar o IP do rate limit.
  if (trustProxyHops > 0) {
    (app as NestExpressApplication).set('trust proxy', trustProxyHops);
  }

  // 410 e 423 do site fora do ar com Cache-Control: no-store (Data de saída do ar RN08).
  app.useGlobalFilters(new NoStoreGoneFilter(app.get(HttpAdapterHost).httpAdapter));

  // Rotas de produto sob /v1; rotas de infraestrutura (ex.: /health) usam
  // VERSION_NEUTRAL e ficam fora do prefixo (decisão 97).
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Campo inesperado é 400, no formato nativo do NestJS (decisões 97 e 99),
  // com errors[{ path, code, params }] ao lado para o app montar o texto (190).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
      // O Nest tira o target do erro por padrão, e os params saem dos
      // metadados da classe dele; o valor enviado fica fora (dado pessoal).
      validationError: { target: true, value: false },
    }),
  );

  // O app e o site chamam a API de outra origem com cookies: CORS por rota,
  // com a mesma regra do OriginGuard (Site público RN07; decisão 207, item 4).
  // Nas rotas do app, só as origens da lista; nas @SiteRoute(), também a do
  // site. O CORS roda antes do roteamento (o preflight não chega a rota), então
  // o caminho é conferido no registro montado dos metadados. O
  // Content-Disposition fica legível, para o nome do arquivo da exportação
  // (decisão 212(4)).
  const siteRoutes = optionalProvider(app, SiteRouteRegistry);
  const corsByRoute: CorsOptionsDelegate<Request> = (request, callback) => {
    const origin = request.headers.origin;
    const allowed = originsFor({
      isSiteRoute:
        siteRoutes?.isSiteRoute({
          path: request.path,
          // No preflight, o método da requisição que vem depois.
          method:
            request.method === 'OPTIONS'
              ? String(request.headers['access-control-request-method'] ?? '')
              : request.method,
        }) ?? false,
      appOrigins: allowedOrigins,
      siteOrigin,
    });
    callback(null, {
      origin: origin !== undefined && allowed.includes(origin) ? origin : false,
      credentials: true,
      exposedHeaders: ['Content-Disposition'],
    });
  };
  app.enableCors(corsByRoute);

  // O cookie de sessão (HttpOnly) é lido pelo SessionGuard.
  app.use(cookieParser());

  app.enableShutdownHooks();

  if (enableDocs) {
    SwaggerModule.setup(API_DOCS_PATH, app, buildOpenApiDocument({ app }));
  }

  return app;
}

/** O documento OpenAPI gerado do código (ADR do Swagger), servido em /docs e exportado. */
export function buildOpenApiDocument({ app }: { app: INestApplication }): OpenAPIObject {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('Kore API').setVersion('1').build(),
  );
  // Constantes do domínio sem rota (ex.: os títulos do modelo de planilha).
  document.components = {
    ...document.components,
    schemas: { ...document.components?.schemas, ...OPENAPI_CONSTANT_SCHEMAS },
  };
  // Casamento bloqueado RN02: o 403 e o 409 do guard em toda escrita do casamento.
  return addWeddingWriteErrors(document);
}

/** O provider, quando o módulo dele está no app (o teste do configureApp não tem). */
function optionalProvider<T>(app: INestApplication, type: new (...args: never[]) => T): T | null {
  try {
    return app.get(type, { strict: false });
  } catch {
    return null;
  }
}
