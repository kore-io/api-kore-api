import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { BACKOFFICE_DB_ROLE } from '@/shared/database/backoffice-prisma.service';
import { changePlatformRole, parsePlatformRoleArgs } from './change-platform-role';

/**
 * pnpm staff:role: dá ou tira o papel do staff (Backoffice - acesso RN01;
 * decisão 275), pela conexão do backoffice, com a linha no log da aplicação.
 * Roda em qualquer ambiente: é assim que nasce o primeiro Admin. Sem o
 * dotenv (devDependency, fora da imagem de produção): as variáveis vêm do
 * host; em local, `node --env-file=.env` (o `pnpm staff:role`).
 */
async function main(): Promise<void> {
  const input = parsePlatformRoleArgs({ argv: process.argv.slice(2) });
  const connectionString = process.env.DATABASE_BACKOFFICE_URL;
  if (!connectionString) throw new Error('Falta DATABASE_BACKOFFICE_URL.');
  // Como a BackofficePrismaService: o BYPASSRLS não é herdado pela participação no papel.
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString, options: `-c role=${BACKOFFICE_DB_ROLE}` }),
  });
  try {
    const result = await changePlatformRole({ db, input, now: new Date() });
    console.log(
      result.outcome === 'changed'
        ? `Papel de ${input.email}: ${result.from} → ${result.to} (registrado no log).`
        : `${input.email} já tem o papel ${result.role}; nada mudou.`,
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
