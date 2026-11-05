// Cria (ou atualiza a senha de) os usuários de login do banco a partir das
// URLs de conexão: o da API (DATABASE_URL), membro de kore_app e sujeito à RLS,
// e o do backoffice e das rotinas (DATABASE_BACKOFFICE_URL), membro de
// kore_backoffice. Só para local e test: nos outros ambientes os usuários são
// criados pela infraestrutura.
import 'dotenv/config';
import { Client } from 'pg';

const ALLOWED_ENVS = ['local', 'test'];

const LOGIN_USERS = [
  { urlEnv: 'DATABASE_URL', groupRole: 'kore_app' },
  { urlEnv: 'DATABASE_BACKOFFICE_URL', groupRole: 'kore_backoffice' },
] as const;

async function main(): Promise<void> {
  const appEnv = process.env.APP_ENV ?? '';
  if (!ALLOWED_ENVS.includes(appEnv)) {
    throw new Error(`db:users só roda com APP_ENV local ou test (atual: "${appEnv}").`);
  }

  const client = new Client({ connectionString: requireEnv({ name: 'DATABASE_MIGRATION_URL' }) });
  await client.connect();
  try {
    for (const { urlEnv, groupRole } of LOGIN_USERS) {
      await upsertLoginUser({ client, url: new URL(requireEnv({ name: urlEnv })), groupRole });
    }
  } finally {
    await client.end();
  }
}

async function upsertLoginUser({
  client,
  url,
  groupRole,
}: {
  client: Client;
  url: URL;
  groupRole: string;
}): Promise<void> {
  const user = decodeURIComponent(url.username);
  const ident = client.escapeIdentifier(user);
  const password = client.escapeLiteral(decodeURIComponent(url.password));
  const { rowCount } = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [user]);
  const verb = rowCount ? 'ALTER' : 'CREATE';
  // O login não tem atributos próprios: BYPASSRLS não é herdado por participação,
  // então a conexão do backoffice assume o papel kore_backoffice (SET ROLE).
  await client.query(`${verb} ROLE ${ident} LOGIN NOBYPASSRLS PASSWORD ${password}`);
  await client.query(`GRANT ${client.escapeIdentifier(groupRole)} TO ${ident}`);
  console.log(`Usuário ${user} pronto (membro de ${groupRole}).`);
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
