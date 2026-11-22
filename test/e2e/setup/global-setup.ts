import { execSync } from 'node:child_process';
import { Client } from 'pg';
import './load-test-env';

/**
 * Prepara o banco real dos testes: cria o kore_test se não existir, aplica as
 * migrations, cria o usuário da API e os buckets do MinIO. Requer o docker
 * compose no ar.
 */
export default async function globalSetup(): Promise<void> {
  const migrationUrl = new URL(process.env.DATABASE_MIGRATION_URL ?? '');
  const testDatabase = migrationUrl.pathname.slice(1);
  if (!testDatabase.endsWith('_test')) {
    throw new Error(`Os testes só rodam num banco *_test (atual: "${testDatabase}").`);
  }

  const adminUrl = new URL(migrationUrl);
  adminUrl.pathname = '/postgres';
  const admin = new Client({ connectionString: adminUrl.toString() });
  try {
    await admin.connect();
  } catch (error) {
    throw new Error(`Postgres fora do ar em ${adminUrl.host}. Rode "docker compose up -d".`, {
      cause: error,
    });
  }
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      testDatabase,
    ]);
    if (!rowCount) {
      await admin.query(`CREATE DATABASE ${admin.escapeIdentifier(testDatabase)}`);
    }
  } finally {
    await admin.end();
  }

  execSync('pnpm -s db:setup', { stdio: 'inherit', env: process.env });
  // Os buckets kore-test-* no MinIO (Imagens do site).
  execSync('pnpm -s storage:setup', { stdio: 'inherit', env: process.env });
}
