-- CreateEnum
CREATE TYPE "wedding_status" AS ENUM ('awaiting_couple', 'draft', 'published', 'post_event', 'grace', 'expired', 'purged');

-- CreateEnum
CREATE TYPE "partner_title" AS ENUM ('bride', 'groom');

-- CreateEnum
CREATE TYPE "membership_role" AS ENUM ('owner', 'collaborator');

-- CreateTable
CREATE TABLE "weddings" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "slug" CITEXT NOT NULL,
    "status" "wedding_status" NOT NULL,
    "event_date" DATE,
    "timezone" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" CHAR(2) NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "last_activity_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partners" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "wedding_id" UUID NOT NULL,
    "slot" SMALLINT NOT NULL,
    "display_name" TEXT NOT NULL,
    "title" "partner_title" NOT NULL,
    "user_id" UUID,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "wedding_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "membership_role" NOT NULL,
    "removed_at" TIMESTAMPTZ(3),
    "removed_by_user_id" UUID,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_weddings_slug" ON "weddings"("slug");

-- CreateIndex
CREATE INDEX "idx_weddings_created_by_user_id" ON "weddings"("created_by_user_id");

-- CreateIndex
CREATE INDEX "idx_partners_user_id" ON "partners"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_partners_wedding_id_slot" ON "partners"("wedding_id", "slot");

-- CreateIndex
CREATE INDEX "idx_memberships_wedding_id" ON "memberships"("wedding_id");

-- CreateIndex
CREATE INDEX "idx_memberships_removed_by_user_id" ON "memberships"("removed_by_user_id");

-- AddForeignKey
ALTER TABLE "weddings" ADD CONSTRAINT "weddings_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_wedding_id_fkey" FOREIGN KEY ("wedding_id") REFERENCES "weddings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_wedding_id_fkey" FOREIGN KEY ("wedding_id") REFERENCES "weddings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_removed_by_user_id_fkey" FOREIGN KEY ("removed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- SQL manual (ADR do Prisma; ADR de multi-tenant; decisão 153) ---------------

-- Um vínculo ativo por pessoa em cada casamento (Modelo de Dados, invariante 3)
-- e o índice da RLS por vínculo: vínculos ativos de uma pessoa.
CREATE UNIQUE INDEX "uq_memberships_wedding_id_user_id_active"
  ON "memberships" ("wedding_id", "user_id") WHERE "removed_at" IS NULL;
CREATE INDEX "idx_memberships_user_id_wedding_id_active"
  ON "memberships" ("user_id", "wedding_id") WHERE "removed_at" IS NULL;

-- Uma pessoa é no máximo um dos noivos de um casamento; são 2 noivos.
CREATE UNIQUE INDEX "uq_partners_wedding_id_user_id"
  ON "partners" ("wedding_id", "user_id") WHERE "user_id" IS NOT NULL;
ALTER TABLE "partners" ADD CONSTRAINT "chk_partners_slot" CHECK ("slot" IN (1, 2));
ALTER TABLE "weddings" ADD CONSTRAINT "chk_weddings_state" CHECK ("state" ~ '^[A-Z]{2}$');

-- Pessoa da requisição, definida com SET LOCAL app.user_id. Sem valor, NULL:
-- nenhuma policy casa e nada aparece (falha fechada).
CREATE FUNCTION current_user_id() RETURNS uuid
  LANGUAGE sql
  STABLE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

-- Dono das funções SECURITY DEFINER da RLS: sem login, só lê os vínculos.
-- BYPASSRLS porque memberships tem FORCE ROW LEVEL SECURITY.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kore_rls') THEN
    CREATE ROLE kore_rls NOLOGIN BYPASSRLS;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA public TO kore_rls;
GRANT SELECT ON "memberships" TO kore_rls;

-- Casamentos em que a pessoa da requisição tem vínculo ativo. Usada nas
-- policies como subconsulta, avaliada uma vez por consulta (decisão 153).
CREATE FUNCTION active_wedding_ids() RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT wedding_id FROM public.memberships
    WHERE user_id = public.current_user_id() AND removed_at IS NULL
  $$;
ALTER FUNCTION active_wedding_ids() OWNER TO kore_rls;
REVOKE ALL ON FUNCTION active_wedding_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION active_wedding_ids() TO kore_app, kore_backoffice;

-- Casamentos em que a pessoa da requisição é dona (vínculo owner ativo).
CREATE FUNCTION owned_wedding_ids() RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT wedding_id FROM public.memberships
    WHERE user_id = public.current_user_id() AND role = 'owner' AND removed_at IS NULL
  $$;
ALTER FUNCTION owned_wedding_ids() OWNER TO kore_rls;
REVOKE ALL ON FUNCTION owned_wedding_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION owned_wedding_ids() TO kore_app, kore_backoffice;

-- RLS por vínculo (decisão 153): vê o casamento quem tem vínculo ativo; com o
-- casamento definido (SET LOCAL app.wedding_id), só ele. FORCE: nem o dono da
-- tabela escapa.
ALTER TABLE "weddings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "weddings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "weddings_member_select" ON "weddings" FOR SELECT
  USING (id IN (SELECT active_wedding_ids())
         AND (current_wedding_id() IS NULL OR id = current_wedding_id()));
CREATE POLICY "weddings_member_update" ON "weddings" FOR UPDATE
  USING (id IN (SELECT active_wedding_ids())
         AND (current_wedding_id() IS NULL OR id = current_wedding_id()))
  WITH CHECK (id IN (SELECT active_wedding_ids()));

ALTER TABLE "partners" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "partners" FORCE ROW LEVEL SECURITY;
CREATE POLICY "partners_member_select" ON "partners" FOR SELECT
  USING (wedding_id IN (SELECT active_wedding_ids())
         AND (current_wedding_id() IS NULL OR wedding_id = current_wedding_id()));
CREATE POLICY "partners_member_update" ON "partners" FOR UPDATE
  USING (wedding_id IN (SELECT active_wedding_ids())
         AND (current_wedding_id() IS NULL OR wedding_id = current_wedding_id()))
  WITH CHECK (wedding_id IN (SELECT active_wedding_ids()));

-- Vínculos: a pessoa vê os próprios, em qualquer casamento (Meus casamentos,
-- perfis), e os dos casamentos em que tem vínculo (colaboradores).
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
CREATE POLICY "memberships_member_select" ON "memberships" FOR SELECT
  USING ((user_id = current_user_id() OR wedding_id IN (SELECT active_wedding_ids()))
         AND (current_wedding_id() IS NULL OR wedding_id = current_wedding_id()));
-- Alterar um vínculo (hoje, só removê-lo): a própria pessoa (sair, RN06 e RN07
-- de Papéis) ou um dono do casamento (remover colaborador, RN06). O WITH CHECK
-- repete a regra: a linha não pode sair do casamento da pessoa.
CREATE POLICY "memberships_member_update" ON "memberships" FOR UPDATE
  USING ((user_id = current_user_id() OR wedding_id IN (SELECT owned_wedding_ids()))
         AND (current_wedding_id() IS NULL OR wedding_id = current_wedding_id()))
  WITH CHECK ((user_id = current_user_id() OR wedding_id IN (SELECT owned_wedding_ids()))
              AND wedding_id IN (SELECT active_wedding_ids()));

-- Inclusões e exclusões ficam sem policy aqui (negadas): o cadastro e o aceite
-- de convite trazem as próprias (decisão 153, item 4).

-- Colunas que a API pode alterar. As que ligam a linha a um casamento, a uma
-- pessoa ou a um papel (id, wedding_id, user_id, role, created_by_user_id) são
-- imutáveis pela API: nem a RLS precisa barrar uma troca de casamento ou de
-- papel, porque o próprio GRANT não deixa. O user_id do noivo é preenchido
-- no aceite do convite, que traz a sua regra.
REVOKE UPDATE ON "weddings", "partners", "memberships" FROM kore_app;
GRANT UPDATE ("slug", "status", "event_date", "timezone", "city", "state", "last_activity_at", "updated_at")
  ON "weddings" TO kore_app;
GRANT UPDATE ("display_name", "title", "updated_at") ON "partners" TO kore_app;
GRANT UPDATE ("removed_at", "removed_by_user_id") ON "memberships" TO kore_app;
