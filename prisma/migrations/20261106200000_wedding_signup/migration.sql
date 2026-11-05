-- CreateEnum
CREATE TYPE "referral_source" AS ENUM ('created_by_planner', 'created_by_seller', 'referral_link', 'invited_before_payment', 'admin_reassigned');

-- CreateEnum
CREATE TYPE "signup_source" AS ENUM ('direct', 'simulator', 'referral_link', 'planner', 'made_with_kore');

-- AlterTable
ALTER TABLE "weddings" ADD COLUMN     "referral_source" "referral_source",
ADD COLUMN     "referrer_id" UUID,
ADD COLUMN     "signup_source" "signup_source" NOT NULL DEFAULT 'direct',
ADD COLUMN     "utm_campaign" TEXT,
ADD COLUMN     "utm_medium" TEXT,
ADD COLUMN     "utm_source" TEXT;

-- AlterTable
ALTER TABLE "partners" ALTER COLUMN "title" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "idx_weddings_referrer_id_status" ON "weddings"("referrer_id", "status");

-- AddForeignKey
ALTER TABLE "weddings" ADD CONSTRAINT "weddings_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "referrers"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- SQL manual (ADR do Prisma; ADR de multi-tenant; decisões 153 e 166) --------

-- O default só preenche linhas antigas; o cadastro sempre informa a origem.
ALTER TABLE "weddings" ALTER COLUMN "signup_source" DROP DEFAULT;

-- Indicador e forma de atribuição andam juntos.
ALTER TABLE "weddings" ADD CONSTRAINT "chk_weddings_referral"
  CHECK (("referrer_id" IS NULL) = ("referral_source" IS NULL));

-- Endereço em uso (RN05 de Cadastro): a RLS esconde os casamentos dos outros,
-- então a checagem passa por esta função, que só devolve sim ou não.
CREATE FUNCTION wedding_slug_taken(candidate citext) RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$ SELECT EXISTS (SELECT 1 FROM public.weddings WHERE slug = candidate) $$;
GRANT SELECT ON "weddings" TO kore_rls;
ALTER FUNCTION wedding_slug_taken(citext) OWNER TO kore_rls;
REVOKE ALL ON FUNCTION wedding_slug_taken(citext) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wedding_slug_taken(citext) TO kore_app, kore_backoffice;

-- Casamentos criados pela pessoa da requisição que ainda não têm vínculo:
-- só o cadastro, na mesma transação, cria o vínculo de dono (decisão 153, item 4).
CREATE FUNCTION unclaimed_created_wedding_ids() RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT w.id FROM public.weddings w
    WHERE w.created_by_user_id = public.current_user_id()
      AND NOT EXISTS (SELECT 1 FROM public.memberships m WHERE m.wedding_id = w.id)
  $$;
ALTER FUNCTION unclaimed_created_wedding_ids() OWNER TO kore_rls;
REVOKE ALL ON FUNCTION unclaimed_created_wedding_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION unclaimed_created_wedding_ids() TO kore_app, kore_backoffice;

-- Cadastro (RN07): o casamento nasce criado pela própria pessoa, em rascunho;
-- o vínculo de dono só no casamento que ela acabou de criar; os noivos só no
-- casamento de que ela é dona, e o login de um noivo só pode ser o dela (o
-- outro noivo entra pelo aceite do convite, com regra própria).
CREATE POLICY "weddings_signup_insert" ON "weddings" FOR INSERT
  WITH CHECK ("created_by_user_id" = current_user_id() AND "status" = 'draft');
CREATE POLICY "memberships_signup_insert" ON "memberships" FOR INSERT
  WITH CHECK ("user_id" = current_user_id() AND "role" = 'owner' AND "removed_at" IS NULL
              AND "wedding_id" IN (SELECT unclaimed_created_wedding_ids()));
CREATE POLICY "partners_owner_insert" ON "partners" FOR INSERT
  WITH CHECK ("wedding_id" IN (SELECT owned_wedding_ids())
              AND ("user_id" IS NULL OR "user_id" = current_user_id()));

-- O indicador e a origem são gravados só na criação: a reatribuição é do
-- Admin, pelo backoffice (Modelo de Dados, invariante 12.1). O GRANT de
-- UPDATE por coluna da migration dos casamentos já deixa estas de fora.
