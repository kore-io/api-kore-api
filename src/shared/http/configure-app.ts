import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const API_DOCS_PATH = 'docs';

/**
 * Comportamento HTTP global, aplicado igual no main e nos testes e2e, para o
 * teste exercitar a mesma pilha que roda em produção.
 */
export function configureApp({
  app,
  enableDocs,
}: {
  app: INestApplication;
  enableDocs: boolean;
}): INestApplication {
  // Rotas de produto sob /v1; rotas de infraestrutura (ex.: /health) usam
  // VERSION_NEUTRAL e ficam fora do prefixo (decisão 97).
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Campo inesperado é 400, no formato nativo do NestJS (decisões 97 e 99).
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

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
