// Cria (ou atualiza a senha de) o usuário de login da API, membro de kore_app,
// a partir do usuário e da senha que estão em DATABASE_URL. Só para local e
// test: nos outros ambientes os usuários são criados pela infraestrutura.
import 'dotenv/config';
import { Client } from 'pg';

const ALLOWED_ENVS = ['local', 'test'];

async function main(): Promise<void> {
  const appEnv = process.env.APP_ENV ?? '';
  if (!ALLOWED_ENVS.includes(appEnv)) {
    throw new Error(`db:users só roda com APP_ENV local ou test (atual: "${appEnv}").`);
  }

  const apiUrl = new URL(requireEnv({ name: 'DATABASE_URL' }));
  const user = decodeURIComponent(apiUrl.username);
  const password = decodeURIComponent(apiUrl.password);

  const client = new Client({ connectionString: requireEnv({ name: 'DATABASE_MIGRATION_URL' }) });
  await client.connect();
  try {
    const ident = client.escapeIdentifier(user);
    const literal = client.escapeLiteral(password);
    const { rowCount } = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [user]);
    const verb = rowCount ? 'ALTER' : 'CREATE';
    await client.query(`${verb} ROLE ${ident} LOGIN NOBYPASSRLS PASSWORD ${literal}`);
    await client.query(`GRANT kore_app TO ${ident}`);
    console.log(`Usuário ${user} pronto (membro de kore_app).`);
  } finally {
    await client.end();
  }
}

function requireEnv({ name }: { name: string }): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável ${name} não definida.`);
  return value;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
