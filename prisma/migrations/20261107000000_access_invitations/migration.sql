-- CreateEnum
CREATE TYPE "access_invitation_kind" AS ENUM ('partner', 'couple', 'planner');

-- CreateTable
CREATE TABLE "access_invitations" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "wedding_id" UUID NOT NULL,
    "kind" "access_invitation_kind" NOT NULL,
    "email" CITEXT,
    "role" "membership_role" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_by_user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "accepted_by_user_id" UUID,
    "accepted_for_email" CITEXT,
    "declined_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "superseded_at" TIMESTAMPTZ(3),

    CONSTRAINT "access_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_access_invitations_token_hash" ON "access_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "idx_access_invitations_wedding_id" ON "access_invitations"("wedding_id");

-- CreateIndex
CREATE INDEX "idx_access_invitations_invited_by_user_id" ON "access_invitations"("invited_by_user_id");

-- CreateIndex
CREATE INDEX "idx_access_invitations_accepted_by_user_id" ON "access_invitations"("accepted_by_user_id");

-- AddForeignKey
ALTER TABLE "access_invitations" ADD CONSTRAINT "access_invitations_wedding_id_fkey" FOREIGN KEY ("wedding_id") REFERENCES "weddings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_invitations" ADD CONSTRAINT "access_invitations_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_invitations" ADD CONSTRAINT "access_invitations_accepted_by_user_id_fkey" FOREIGN KEY ("accepted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- SQL manual (ADR do Prisma; ADR de multi-tenant; decisões 99, 102, 153 e 168)

-- O cerimonialista entra como colaborador; parceiro e casal, como donos (RN01).
ALTER TABLE "access_invitations" ADD CONSTRAINT "chk_access_invitations_role"
  CHECK (("kind" = 'planner') = ("role" = 'collaborator'));
-- Sem e-mail, só o link do casal (RN14).
ALTER TABLE "access_invitations" ADD CONSTRAINT "chk_access_invitations_email"
  CHECK ("email" IS NOT NULL OR "kind" = 'couple');

-- Um convite pendente por e-mail em cada casamento (RN04; Modelo de Dados,
-- invariante 5) e no máximo um link do casal pendente (decisão 102). O vencido
-- continua pendente até ser reenviado.
CREATE UNIQUE INDEX "uq_access_invitations_wedding_id_email_pending"
  ON "access_invitations" ("wedding_id", "email")
  WHERE "email" IS NOT NULL AND "accepted_at" IS NULL AND "declined_at" IS NULL
    AND "revoked_at" IS NULL AND "superseded_at" IS NULL;
CREATE UNIQUE INDEX "uq_access_invitations_wedding_id_couple_link_pending"
  ON "access_invitations" ("wedding_id")
  WHERE "kind" = 'couple' AND "email" IS NULL AND "accepted_at" IS NULL
    AND "declined_at" IS NULL AND "revoked_at" IS NULL AND "superseded_at" IS NULL;

-- RLS por vínculo (decisão 153). Ver: quem tem vínculo com o casamento.
ALTER TABLE "access_invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "access_invitations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "access_invitations_member_select" ON "access_invitations" FOR SELECT
  USING ("wedding_id" IN (SELECT active_wedding_ids())
         AND (current_wedding_id() IS NULL OR "wedding_id" = current_wedding_id()));

-- Enviar (RN02), como segunda barreira da autorização central: em nome da
-- própria pessoa, pendente; parceiro e cerimonialista só por um dono; o do
-- casal só pelo indicador que criou o casamento, enquanto ele não tem dono.
CREATE POLICY "access_invitations_member_insert" ON "access_invitations" FOR INSERT
  WITH CHECK (
    "invited_by_user_id" = current_user_id()
    AND (current_wedding_id() IS NULL OR "wedding_id" = current_wedding_id())
    AND "accepted_at" IS NULL AND "declined_at" IS NULL
    AND "revoked_at" IS NULL AND "superseded_at" IS NULL
    AND (
      ("kind" IN ('partner', 'planner') AND "wedding_id" IN (SELECT owned_wedding_ids()))
      OR ("kind" = 'couple'
          AND "wedding_id" IN (SELECT active_wedding_ids())
          AND "wedding_id" IN (SELECT id FROM weddings
                               WHERE created_by_user_id = current_user_id()
                                 AND referral_source IN ('created_by_planner', 'created_by_seller'))
          AND "wedding_id" NOT IN (SELECT wedding_id FROM memberships
                                   WHERE role = 'owner' AND removed_at IS NULL))
    )
  );

-- Cancelar e substituir (RN04, RN05): quem tem vínculo; só as colunas abaixo.
-- Aceite e recusa entram com as suas regras (branch 59-convites-aceite).
CREATE POLICY "access_invitations_member_update" ON "access_invitations" FOR UPDATE
  USING ("wedding_id" IN (SELECT active_wedding_ids())
         AND (current_wedding_id() IS NULL OR "wedding_id" = current_wedding_id()))
  WITH CHECK ("wedding_id" IN (SELECT active_wedding_ids()));
REVOKE UPDATE, DELETE ON "access_invitations" FROM kore_app;
GRANT UPDATE ("revoked_at", "superseded_at") ON "access_invitations" TO kore_app;

-- Brecha do cadastro (decisão 168, item 10): o indicador nunca vira dono pelo
-- cadastro do casamento que ele mesmo criou para o casal.
CREATE OR REPLACE FUNCTION unclaimed_created_wedding_ids() RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT w.id FROM public.weddings w
    WHERE w.created_by_user_id = public.current_user_id()
      AND (w.referral_source IS NULL
           OR w.referral_source NOT IN ('created_by_planner', 'created_by_seller'))
      AND NOT EXISTS (SELECT 1 FROM public.memberships m WHERE m.wedding_id = w.id)
  $$;
