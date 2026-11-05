import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';

export const API_DOCS_PATH = 'docs';

/**
 * Comportamento HTTP global, aplicado igual no main e nos testes e2e, para o
 * teste exercitar a mesma pilha que roda em produção.
 */
export function configureApp({
  app,
  enableDocs,
  allowedOrigins,
}: {
  app: INestApplication;
  enableDocs: boolean;
  allowedOrigins: readonly string[];
}): INestApplication {
  // Rotas de produto sob /v1; rotas de infraestrutura (ex.: /health) usam
  // VERSION_NEUTRAL e ficam fora do prefixo (decisão 97).
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Campo inesperado é 400, no formato nativo do NestJS (decisões 97 e 99).
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // O app chama a API de outra origem com o cookie de sessão: só as origens da
  // lista recebem os cabeçalhos de CORS (a mesma lista do OriginGuard).
  app.enableCors({ origin: [...allowedOrigins], credentials: true });

  // O cookie de sessão (HttpOnly) é lido pelo SessionGuard.
  app.use(cookieParser());

  app.enableShutdownHooks();

  if (enableDocs) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Kore API').setVersion('1').build(),
    );
    SwaggerModule.setup(API_DOCS_PATH, app, document);
  }

  return app;
}
