-- Fundação do banco: extensão citext, papéis de banco e a função que a RLS
-- usa para saber o casamento da transação (ADR de multi-tenant e ADR do Prisma).
-- SQL manual: o schema.prisma não expressa nada disto.

CREATE EXTENSION IF NOT EXISTS citext;

-- Papéis de grupo, sem login. Cada ambiente cria os usuários de login e os
-- põe num destes papéis (no local: pnpm db:users).
--   kore_app        API do produto, sujeita à RLS.
--   kore_backoffice backoffice e rotinas agendadas, com BYPASSRLS; todo acesso
--                   é registrado no log da aplicação.
-- Papéis são do cluster, não do banco: o IF NOT EXISTS deixa a migration rodar
-- em mais de um banco do mesmo servidor (ex.: kore e kore_test).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kore_app') THEN
    CREATE ROLE kore_app NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kore_backoffice') THEN
    CREATE ROLE kore_backoffice NOLOGIN BYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO kore_app, kore_backoffice;

-- Tabelas e sequências criadas pelas próximas migrations (rodadas pelo dono)
-- já nascem acessíveis aos dois papéis. Nenhum deles é dono de tabela: dono
-- ignora a RLS.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kore_app, kore_backoffice;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO kore_app, kore_backoffice;

-- Casamento da transação corrente, definido com SET LOCAL app.wedding_id.
-- Sem valor, devolve NULL, e a policy (wedding_id = current_wedding_id()) não
-- casa com nenhuma linha: esquecer o SET LOCAL nega acesso em vez de vazar.
CREATE FUNCTION current_wedding_id() RETURNS uuid
  LANGUAGE sql
  STABLE
  AS $$ SELECT NULLIF(current_setting('app.wedding_id', true), '')::uuid $$;
