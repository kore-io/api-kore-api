-- CreateEnum
CREATE TYPE "application_log_actor" AS ENUM ('user', 'party', 'admin', 'system');

-- CreateEnum
CREATE TYPE "access_ip_log_actor" AS ENUM ('user', 'party');

-- CreateTable
CREATE TABLE "application_logs" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "wedding_id" UUID,
    "actor_kind" "application_log_actor" NOT NULL,
    "actor_user_id" UUID,
    "support_session_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "data" JSONB,
    "ip_hash" TEXT,

    CONSTRAINT "application_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_ip_logs" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "ip" INET NOT NULL,
    "actor_kind" "access_ip_log_actor" NOT NULL,
    "actor_user_id" UUID,
    "party_id" UUID,
    "action" TEXT NOT NULL,

    CONSTRAINT "access_ip_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_application_logs_wedding_id_created_at" ON "application_logs"("wedding_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_application_logs_actor_user_id_created_at" ON "application_logs"("actor_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_application_logs_action_created_at" ON "application_logs"("action", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_access_ip_logs_occurred_at" ON "access_ip_logs"("occurred_at");

-- SQL manual (ADR do Prisma) -------------------------------------------------

-- Quem agiu precisa estar identificado conforme o tipo de ator.
ALTER TABLE "application_logs" ADD CONSTRAINT "chk_application_logs_actor"
  CHECK (
    (actor_kind IN ('user', 'admin') AND actor_user_id IS NOT NULL)
    OR actor_kind IN ('party', 'system')
  );
ALTER TABLE "access_ip_logs" ADD CONSTRAINT "chk_access_ip_logs_actor"
  CHECK (
    (actor_kind = 'user' AND actor_user_id IS NOT NULL)
    OR (actor_kind = 'party' AND party_id IS NOT NULL)
  );

-- Só inserção: a API (kore_app) só grava; nada é alterado. As permissões
-- padrão da migration de fundação davam SELECT/UPDATE/DELETE: aqui ficam só as
-- necessárias.
REVOKE ALL ON "application_logs", "access_ip_logs" FROM kore_app, kore_backoffice;
GRANT INSERT ON "application_logs", "access_ip_logs" TO kore_app;
-- Backoffice e rotinas: leem o log; só a rotina de retenção apaga IP vencido.
GRANT SELECT, INSERT ON "application_logs" TO kore_backoffice;
GRANT SELECT, INSERT, DELETE ON "access_ip_logs" TO kore_backoffice;
