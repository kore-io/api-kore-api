import { NestFactory } from '@nestjs/core';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from './app.module';
import { buildOpenApiDocument, configureApp } from './shared/http/configure-app';

/**
 * Grava o openapi.json da raiz do repositório a partir do código (decisão 149),
 * sem subir servidor: a aplicação é montada, o documento é gerado e ela é
 * fechada. Roda a partir do dist (o plugin do @nestjs/swagger age no build),
 * com o .env.example, para o resultado não depender da máquina.
 *
 * Com `--check`, não grava: falha se o arquivo estiver desatualizado (CI).
 */
async function exportOpenApi(): Promise<void> {
  const check = process.argv.includes('--check');
  const output = resolve('openapi.json');
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  configureApp({
    app,
    enableDocs: false,
    allowedOrigins: [],
    trustProxyHops: 0,
  });
  const content = `${JSON.stringify(buildOpenApiDocument({ app }), null, 2)}\n`;
  await app.close();

  if (!check) {
    writeFileSync(output, content);
    return;
  }
  if (!existsSync(output) || readFileSync(output, 'utf8') !== content) {
    console.error(
      'openapi.json desatualizado: rode "pnpm openapi:export" e faça commit do arquivo.',
    );
    process.exitCode = 1;
  }
}

void exportOpenApi();
