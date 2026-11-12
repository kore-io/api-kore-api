-- CreateEnum
CREATE TYPE "planner_template_kind" AS ENUM ('section_content', 'faq', 'appearance');

-- AlterTable
ALTER TABLE "access_invitations" ADD COLUMN     "token_encrypted" TEXT;

-- AlterTable
ALTER TABLE "planners" ADD COLUMN     "credit_hidden_at" TIMESTAMPTZ(3),
ADD COLUMN     "credit_hidden_reason" TEXT;

-- AlterTable
ALTER TABLE "weddings" ADD COLUMN     "show_planner_credit" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "planner_templates" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "planner_id" UUID NOT NULL,
    "kind" "planner_template_kind" NOT NULL,
    "section_type" "section_type",
    "name" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'pt-BR',
    "content" JSONB NOT NULL,

    CONSTRAINT "planner_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_digest_states" (
    "user_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "last_digest_date" DATE,

    CONSTRAINT "notification_digest_states_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE INDEX "idx_planner_templates_planner_id_kind_created_at" ON "planner_templates"("planner_id", "kind", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "planner_templates" ADD CONSTRAINT "planner_templates_planner_id_fkey" FOREIGN KEY ("planner_id") REFERENCES "planners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_digest_states" ADD CONSTRAINT "notification_digest_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- SQL manual (decisões 223 e 224; specs da F6) --------------------------------

-- Perfil do cerimonialista (Cadastro e perfil RN04, RN05 e RN09; revisão C1-2).
-- Até aqui, sem RLS: o kore_app criava e lia, sem alterar. Agora a pessoa
-- altera só o próprio perfil e a própria assessoria; a leitura segue livre
-- (o destaque do GET /v1/referrals/{código}). As colunas do Admin
-- (credit_hidden_*) ficam fora do GRANT.
CREATE FUNCTION current_referrer_id() RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT r.id FROM public.referrers r
    WHERE r.user_id = public.current_user_id() AND r.status = 'active'
  $$;
ALTER FUNCTION current_referrer_id() OWNER TO kore_rls;
REVOKE ALL ON FUNCTION current_referrer_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION current_referrer_id() TO kore_app, kore_backoffice;

-- O Planner da pessoa: só do indicador cerimonialista ativo (Modelos; revisão C6-2).
CREATE FUNCTION current_planner_id() RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT p.id FROM public.planners p
    JOIN public.referrers r ON r.id = p.referrer_id
    WHERE r.user_id = public.current_user_id() AND r.kind = 'planner' AND r.status = 'active'
  $$;
ALTER FUNCTION current_planner_id() OWNER TO kore_rls;
REVOKE ALL ON FUNCTION current_planner_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION current_planner_id() TO kore_app, kore_backoffice;

-- O perfil é criado na mesma transação do Referrer da pessoa (o cadastro e o
-- perfil mínimo do aceite); a função SECURITY DEFINER enxerga a linha nova.
CREATE FUNCTION own_referrer_ids() RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$ SELECT r.id FROM public.referrers r WHERE r.user_id = public.current_user_id() $$;
ALTER FUNCTION own_referrer_ids() OWNER TO kore_rls;
REVOKE ALL ON FUNCTION own_referrer_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION own_referrer_ids() TO kore_app, kore_backoffice;

ALTER TABLE "planners" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "planners" FORCE ROW LEVEL SECURITY;
CREATE POLICY "planners_public_select" ON "planners" FOR SELECT USING (true);
CREATE POLICY "planners_own_insert" ON "planners" FOR INSERT
  WITH CHECK ("referrer_id" IN (SELECT own_referrer_ids()));
CREATE POLICY "planners_own_update" ON "planners" FOR UPDATE
  USING ("referrer_id" IN (SELECT own_referrer_ids()))
  WITH CHECK ("referrer_id" IN (SELECT own_referrer_ids()));
GRANT UPDATE ("credit_name", "phone", "whatsapp", "cities", "updated_at") ON "planners" TO kore_app;

ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organizations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "organizations_public_select" ON "organizations" FOR SELECT USING (true);
CREATE POLICY "organizations_own_insert" ON "organizations" FOR INSERT
  WITH CHECK ("created_by_user_id" = current_user_id());
CREATE POLICY "organizations_owner_update" ON "organizations" FOR UPDATE
  USING ("id" IN (SELECT m.organization_id FROM organization_members m
                  WHERE m.user_id = current_user_id() AND m.role = 'owner'
                    AND m.removed_at IS NULL))
  WITH CHECK ("id" IN (SELECT m.organization_id FROM organization_members m
                       WHERE m.user_id = current_user_id() AND m.role = 'owner'
                         AND m.removed_at IS NULL));
GRANT UPDATE ("name") ON "organizations" TO kore_app;

-- Assinatura no rodapé (Assinatura RN05): só o dono muda, pela ação
-- manage_planner_credit; a RLS por vínculo da UPDATE de weddings já vale.
GRANT UPDATE ("show_planner_credit") ON "weddings" TO kore_app;

-- Novo casamento pelo cerimonialista (RN04; revisão C3-3). Casamentos que a
-- pessoa criou como cerimonialista, atribuídos ao Referrer dela, sem dono ativo.
CREATE FUNCTION planner_ownerless_wedding_ids() RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT w.id FROM public.weddings w
    JOIN public.referrers r ON r.id = w.referrer_id
    WHERE w.created_by_user_id = public.current_user_id()
      AND w.referral_source = 'created_by_planner'
      AND r.user_id = public.current_user_id() AND r.kind = 'planner' AND r.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM public.memberships m
                      WHERE m.wedding_id = w.id AND m.role = 'owner' AND m.removed_at IS NULL)
  $$;
ALTER FUNCTION planner_ownerless_wedding_ids() OWNER TO kore_rls;
REVOKE ALL ON FUNCTION planner_ownerless_wedding_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION planner_ownerless_wedding_ids() TO kore_app, kore_backoffice;

-- O vínculo collaborator só no casamento recém-criado por ela, ainda sem
-- vínculo nenhum (na mesma transação da criação).
CREATE FUNCTION planner_unclaimed_wedding_ids() RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT w.id FROM public.planner_ownerless_wedding_ids() AS w(id)
    WHERE NOT EXISTS (SELECT 1 FROM public.memberships m WHERE m.wedding_id = w.id)
  $$;
ALTER FUNCTION planner_unclaimed_wedding_ids() OWNER TO kore_rls;
REVOKE ALL ON FUNCTION planner_unclaimed_wedding_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION planner_unclaimed_wedding_ids() TO kore_app, kore_backoffice;
CREATE POLICY "memberships_planner_insert" ON "memberships" FOR INSERT
  WITH CHECK ("user_id" = current_user_id() AND "role" = 'collaborator' AND "removed_at" IS NULL
              AND "wedding_id" IN (SELECT planner_unclaimed_wedding_ids()));
-- Os noivos, sem login, nesse casamento.
CREATE POLICY "partners_planner_insert" ON "partners" FOR INSERT
  WITH CHECK ("user_id" IS NULL AND "wedding_id" IN (SELECT planner_ownerless_wedding_ids()));
-- Restritiva: as policies permissivas se somam, então só uma restritiva
-- impede que o kore_app grave a atribuição de outro indicador. O link de
-- indicação (referral_link) segue com o indicador do código; as outras origens
-- são do aceite (função do banco) e do Admin (backoffice).
CREATE POLICY "weddings_referral_insert_guard" ON "weddings" AS RESTRICTIVE FOR INSERT
  WITH CHECK ("referral_source" IS NULL
              OR "referral_source" = 'referral_link'
              OR ("referral_source" IN ('created_by_planner', 'created_by_seller')
                  AND "referrer_id" = current_referrer_id()));

-- Link do casal (Meus casamentos RN09; N1(b)): só o convite do casal sem
-- e-mail guarda o token cifrado.
ALTER TABLE "access_invitations" ADD CONSTRAINT "chk_access_invitations_token_encrypted"
  CHECK ("token_encrypted" IS NULL OR ("kind" = 'couple' AND "email" IS NULL));
GRANT UPDATE ("token_encrypted") ON "access_invitations" TO kore_app, kore_rls;

-- Modelos do cerimonialista (Modelos RN01 a RN04; revisão C6-2 e C6-8).
ALTER TABLE "planner_templates" ADD CONSTRAINT "chk_planner_templates_section_type"
  CHECK (("kind" = 'section_content' AND "section_type" IS NOT NULL
          AND "section_type" IN ('story', 'lodging', 'dress_code'))
         OR ("kind" <> 'section_content' AND "section_type" IS NULL));
ALTER TABLE "planner_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "planner_templates" FORCE ROW LEVEL SECURITY;
CREATE POLICY "planner_templates_own_select" ON "planner_templates" FOR SELECT
  USING ("planner_id" = current_planner_id());
CREATE POLICY "planner_templates_own_insert" ON "planner_templates" FOR INSERT
  WITH CHECK ("planner_id" = current_planner_id());
CREATE POLICY "planner_templates_own_update" ON "planner_templates" FOR UPDATE
  USING ("planner_id" = current_planner_id()) WITH CHECK ("planner_id" = current_planner_id());
CREATE POLICY "planner_templates_own_delete" ON "planner_templates" FOR DELETE
  USING ("planner_id" = current_planner_id());
REVOKE UPDATE ON "planner_templates" FROM kore_app;
GRANT UPDATE ("name", "content", "updated_at") ON "planner_templates" TO kore_app;

-- Alerta de convites (Meus casamentos RN06): o índice parcial
-- parties (wedding_id, delivery_status) WHERE deleted_at IS NULL já existe
-- desde a F1 (migration guests); nada a criar.

-- Notificações da cerimonialista (RN03 e RN06). O wedding_published uma vez
-- por pessoa e casamento (segunda barreira, além do publishedAt).
CREATE UNIQUE INDEX "uq_notifications_user_id_wedding_id_wedding_published"
  ON "notifications" ("user_id", "wedding_id") WHERE "type" = 'wedding_published';

-- Preferência geral (weddingId nulo; revisão C8-6 e R7-6): uma por pessoa e
-- tipo, e as três policies ganham o ramo da própria pessoa.
CREATE UNIQUE INDEX "uq_notification_preferences_user_id_type_general"
  ON "notification_preferences" ("user_id", "type") WHERE "wedding_id" IS NULL;
DROP POLICY "notification_preferences_own_select" ON "notification_preferences";
DROP POLICY "notification_preferences_own_insert" ON "notification_preferences";
DROP POLICY "notification_preferences_own_update" ON "notification_preferences";
CREATE POLICY "notification_preferences_own_select" ON "notification_preferences" FOR SELECT
  USING ("user_id" = current_user_id()
         AND ("wedding_id" IS NULL OR "wedding_id" IN (SELECT active_wedding_ids())));
CREATE POLICY "notification_preferences_own_insert" ON "notification_preferences" FOR INSERT
  WITH CHECK ("user_id" = current_user_id()
              AND ("wedding_id" IS NULL OR "wedding_id" IN (SELECT active_wedding_ids())));
CREATE POLICY "notification_preferences_own_update" ON "notification_preferences" FOR UPDATE
  USING ("user_id" = current_user_id()
         AND ("wedding_id" IS NULL OR "wedding_id" IN (SELECT active_wedding_ids())))
  WITH CHECK ("user_id" = current_user_id()
              AND ("wedding_id" IS NULL OR "wedding_id" IN (SELECT active_wedding_ids())));

-- Estado do resumo agrupado (RN07; revisão C8-7): só o worker lê e grava.
ALTER TABLE "notification_digest_states" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_digest_states" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "notification_digest_states" FROM kore_app;
