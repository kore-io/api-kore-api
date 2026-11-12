-- DropForeignKey
ALTER TABLE "weddings" DROP CONSTRAINT "weddings_created_by_user_id_fkey";

-- AlterTable
ALTER TABLE "weddings" ADD COLUMN     "purge_notice_sent_at" TIMESTAMPTZ(3),
ADD COLUMN     "purged_at" TIMESTAMPTZ(3),
ALTER COLUMN "slug" DROP NOT NULL,
ALTER COLUMN "timezone" DROP NOT NULL,
ALTER COLUMN "city" DROP NOT NULL,
ALTER COLUMN "state" DROP NOT NULL,
ALTER COLUMN "created_by_user_id" DROP NOT NULL,
ALTER COLUMN "signup_source" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "weddings" ADD CONSTRAINT "weddings_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- SQL manual (RN13 de Convites; decisões 102, 136 e 180) ----------------------

-- Lápide do expurgo (Modelo de Dados): só a linha expurgada pode ficar sem
-- endereço, fuso, cidade, UF, quem criou e origem. O slug nulo libera o endereço.
ALTER TABLE "weddings" ADD CONSTRAINT "chk_weddings_tombstone"
  CHECK ("status" = 'purged' OR ("slug" IS NOT NULL AND "timezone" IS NOT NULL
         AND "city" IS NOT NULL AND "state" IS NOT NULL
         AND "created_by_user_id" IS NOT NULL AND "signup_source" IS NOT NULL));
-- Linha já expurgada antes desta migration (não há rotina antes dela, mas o
-- CHECK não pode depender disso): a data do expurgo é a da última alteração.
UPDATE "weddings" SET "purged_at" = "updated_at" WHERE "status" = 'purged' AND "purged_at" IS NULL;
ALTER TABLE "weddings" ADD CONSTRAINT "chk_weddings_purged_at"
  CHECK (("status" = 'purged') = ("purged_at" IS NOT NULL));

-- Rotina do expurgo sem dono: casamentos aguardando o casal ou em rascunho,
-- pela última atividade (Modelo de Dados, índices).
CREATE INDEX "idx_weddings_last_activity_at_ownerless"
  ON "weddings" ("last_activity_at") WHERE "status" IN ('awaiting_couple', 'draft');

-- A atividade nova zera o aviso (decisão 180): a API grava as duas colunas.
GRANT UPDATE ("purge_notice_sent_at") ON "weddings" TO kore_app;
