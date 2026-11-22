-- Backoffice - acesso RN09 (decisão 253(2)): quando o staff trocou o e-mail de
-- acesso da pessoa. Por 48 h, a pessoa não cadastra nem troca chave Pix e não
-- remove membros (409 RECENT_ACCESS_CHANGE); a 2ª troca em 7 dias é só do
-- Admin. Gravado na mesma transação da troca, pelo kore_backoffice; o log
-- user.access_email_changed fica como auditoria.
ALTER TABLE "users" ADD COLUMN "access_email_changed_at" TIMESTAMPTZ(3);

-- O kore_app não grava a coluna nova (nem o platform_role, que só o script de
-- operação dá, Backoffice - acesso RN01): o UPDATE da tabela inteira vira
-- UPDATE por coluna, com as colunas que a API já gravava.
REVOKE UPDATE ON "users" FROM kore_app;
GRANT UPDATE ("created_at", "updated_at", "email", "name", "avatar_key", "status",
              "last_login_at", "terms_version", "terms_accepted_at")
  ON "users" TO kore_app;

-- Decisão 253(1): 3 conferências erradas por casamento em 24 h travam a troca
-- e abrem um Alert; a liberação pelo Admin abre o seu.
ALTER TYPE "alert_type" ADD VALUE 'access_email_locked';
ALTER TYPE "alert_type" ADD VALUE 'access_email_unlocked';
