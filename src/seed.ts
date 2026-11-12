import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';
import { BACKOFFICE_DB_ROLE } from './shared/database/backoffice-prisma.service';
import { assertSeedAllowed, seedSampleData } from './seed/seed-sample-data';

/**
 * pnpm db:seed: grava os Dados de exemplo do Kore da Fase 0 (decisão 181) pela
 * conexão do backoffice (BYPASSRLS). Roda em local, test e homologação; recusa
 * produção. Imprime os links dos convites para o E2E do app.
 */
async function main(): Promise<void> {
  const appEnv = process.env.APP_ENV ?? '';
  assertSeedAllowed({ appEnv });
  const connectionString = process.env.DATABASE_BACKOFFICE_URL;
  const appUrl = process.env.APP_URL;
  if (!connectionString || !appUrl) throw new Error('Faltam DATABASE_BACKOFFICE_URL e APP_URL.');
  // Como a BackofficePrismaService: o BYPASSRLS não é herdado pela participação no papel.
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString, options: `-c role=${BACKOFFICE_DB_ROLE}` }),
  });
  try {
    const invitations = await seedSampleData({
      db,
      appEnv,
      appUrl,
      termsVersion: process.env.TERMS_VERSION ?? '2026-09',
      now: new Date(),
    });
    console.log('Dados de exemplo gravados. Convites de acesso pendentes:');
    for (const { key, url } of invitations) console.log(`- ${key}: ${url}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
