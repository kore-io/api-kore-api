import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// As migrations rodam com o dono do schema; a API conecta com um usuário sem
// privilégio de dono, para a RLS valer (ADR de multi-tenant). A URL é lida sem
// env() porque o `prisma generate` do build da imagem não tem banco nem a variável.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_MIGRATION_URL ?? '' },
});
