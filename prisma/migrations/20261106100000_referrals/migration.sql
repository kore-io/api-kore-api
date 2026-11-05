-- CreateEnum
CREATE TYPE "referrer_kind" AS ENUM ('planner', 'seller');

-- CreateEnum
CREATE TYPE "referrer_status" AS ENUM ('active', 'blocked', 'inactive');

-- CreateEnum
CREATE TYPE "organization_member_role" AS ENUM ('owner', 'member', 'event_staff');

-- CreateTable
CREATE TABLE "referrers" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "referrer_kind" NOT NULL,
    "referral_code" CITEXT NOT NULL,
    "rate_percent" SMALLINT NOT NULL,
    "referral_discount_enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" "referrer_status" NOT NULL DEFAULT 'active',
    "created_by_admin_user_id" UUID,
    "deactivated_at" TIMESTAMPTZ(3),

    CONSTRAINT "referrers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planners" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "referrer_id" UUID NOT NULL,
    "credit_name" TEXT NOT NULL,
    "phone" TEXT,
    "whatsapp" TEXT,
    "cities" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "planners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "created_by_user_id" UUID NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "organization_member_role" NOT NULL,
    "removed_at" TIMESTAMPTZ(3),

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_settings" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "default_rate_percent" SMALLINT NOT NULL,
    "referral_discount_percent" SMALLINT NOT NULL,
    "commission_hold_days" SMALLINT NOT NULL,
    "payout_min_cents" INTEGER NOT NULL,
    "updated_by_user_id" UUID,

    CONSTRAINT "referral_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_referrers_user_id" ON "referrers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_referrers_referral_code" ON "referrers"("referral_code");

-- CreateIndex
CREATE INDEX "idx_referrers_kind_status" ON "referrers"("kind", "status");

-- CreateIndex
CREATE INDEX "idx_referrers_created_by_admin_user_id" ON "referrers"("created_by_admin_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_planners_referrer_id" ON "planners"("referrer_id");

-- CreateIndex
CREATE INDEX "idx_organizations_created_by_user_id" ON "organizations"("created_by_user_id");

-- CreateIndex
CREATE INDEX "idx_organization_members_user_id" ON "organization_members"("user_id");

-- AddForeignKey
ALTER TABLE "referrers" ADD CONSTRAINT "referrers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrers" ADD CONSTRAINT "referrers_created_by_admin_user_id_fkey" FOREIGN KEY ("created_by_admin_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planners" ADD CONSTRAINT "planners_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "referrers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_settings" ADD CONSTRAINT "referral_settings_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- SQL manual (ADR do Prisma; Modelo de Dados) --------------------------------

-- O vendedor é cadastrado pelo Admin; o cerimonialista se cadastra sozinho.
ALTER TABLE "referrers" ADD CONSTRAINT "chk_referrers_created_by_admin_seller_only"
  CHECK ("kind" = 'seller' OR "created_by_admin_user_id" IS NULL);
ALTER TABLE "referrers" ADD CONSTRAINT "chk_referrers_rate_percent"
  CHECK ("rate_percent" BETWEEN 0 AND 100);

-- Um vínculo ativo por pessoa em cada assessoria.
CREATE UNIQUE INDEX "uq_organization_members_organization_id_user_id_active"
  ON "organization_members" ("organization_id", "user_id") WHERE "removed_at" IS NULL;

-- Configurações da indicação: uma linha só, semeada aqui com os padrões do
-- Modelo de Dados (comissão de 20%, desconto de 10% na ativação, 30 dias de
-- carência da comissão, repasse mínimo de R$ 50).
CREATE UNIQUE INDEX "uq_referral_settings_single_row" ON "referral_settings" ((true));
ALTER TABLE "referral_settings" ADD CONSTRAINT "chk_referral_settings_percents"
  CHECK ("default_rate_percent" BETWEEN 0 AND 100
         AND "referral_discount_percent" BETWEEN 0 AND 100);
ALTER TABLE "referral_settings" ADD CONSTRAINT "chk_referral_settings_amounts"
  CHECK ("commission_hold_days" >= 0 AND "payout_min_cents" >= 0);
INSERT INTO "referral_settings"
  ("id", "updated_at", "default_rate_percent", "referral_discount_percent",
   "commission_hold_days", "payout_min_cents")
VALUES ('01a1b04d-0500-7db9-b143-fc9efc1cfed2', CURRENT_TIMESTAMP, 20, 10, 30, 5000);

-- A API lê e cria (perfil do cerimonialista no aceite do convite, RN10 de
-- Convites); alterar e apagar entram com as telas que precisarem. As
-- configurações da indicação a API só lê: quem altera é o Admin, pelo
-- backoffice.
REVOKE UPDATE, DELETE ON "referrers", "planners", "organizations", "organization_members"
  FROM kore_app;
REVOKE INSERT, UPDATE, DELETE ON "referral_settings" FROM kore_app;
