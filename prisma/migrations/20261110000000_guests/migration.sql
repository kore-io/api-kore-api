-- CreateEnum
CREATE TYPE "party_delivery_status" AS ENUM ('not_sent', 'sent', 'viewed', 'responded');

-- CreateEnum
CREATE TYPE "guest_age_group" AS ENUM ('adult', 'child', 'baby');

-- CreateEnum
CREATE TYPE "rsvp_status" AS ENUM ('pending', 'confirmed', 'declined');

-- CreateEnum
CREATE TYPE "tag_color" AS ENUM ('wine', 'champagne', 'green', 'amber', 'red', 'blue');

-- AlterEnum (eventos de produto da F1: Importação RN14, Exportação RN08)
ALTER TYPE "product_event_name" ADD VALUE 'importacao';
ALTER TYPE "product_event_name" ADD VALUE 'exportacao_buffet';

-- CreateTable
CREATE TABLE "parties" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "wedding_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "internal_note" TEXT,
    "link_token" TEXT NOT NULL,
    "link_version" INTEGER NOT NULL DEFAULT 1,
    "link_regenerated_at" TIMESTAMPTZ(3),
    "contact_guest_id" UUID,
    "plus_one_slots" INTEGER NOT NULL DEFAULT 0,
    "delivery_status" "party_delivery_status" NOT NULL DEFAULT 'not_sent',
    "responded_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guests" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "wedding_id" UUID NOT NULL,
    "party_id" UUID NOT NULL,
    "name" TEXT,
    "email" CITEXT,
    "phone" TEXT,
    "age_group" "guest_age_group",
    "dietary_restriction" TEXT,
    "is_plus_one" BOOLEAN NOT NULL DEFAULT false,
    "rsvp_status" "rsvp_status" NOT NULL DEFAULT 'pending',
    "responded_at" TIMESTAMPTZ(3),
    "joined_party_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trash_batch_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "guests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "wedding_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" "tag_color",
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "party_tags" (
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "wedding_id" UUID NOT NULL,
    "party_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "party_tags_pkey" PRIMARY KEY ("party_id","tag_id")
);

-- CreateTable
CREATE TABLE "guest_tags" (
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "wedding_id" UUID NOT NULL,
    "guest_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "guest_tags_pkey" PRIMARY KEY ("guest_id","tag_id")
);

-- CreateTable
CREATE TABLE "wedding_stats" (
    "wedding_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guests_total" INTEGER NOT NULL DEFAULT 0,
    "confirmed" INTEGER NOT NULL DEFAULT 0,
    "declined" INTEGER NOT NULL DEFAULT 0,
    "pending" INTEGER NOT NULL DEFAULT 0,
    "adults_confirmed" INTEGER NOT NULL DEFAULT 0,
    "children_confirmed" INTEGER NOT NULL DEFAULT 0,
    "babies_confirmed" INTEGER NOT NULL DEFAULT 0,
    "parties_pending" INTEGER NOT NULL DEFAULT 0,
    -- Coluna gerada (SQL manual): (confirmed + declined) ÷ guests_total, em
    -- porcentagem, 0 sem convidados (Grupos RN16). Ninguém grava.
    "rsvp_percent" DECIMAL(5,2) NOT NULL GENERATED ALWAYS AS (
      CASE WHEN "guests_total" = 0 THEN 0
           ELSE round(100.0 * ("confirmed" + "declined") / "guests_total", 2) END
    ) STORED,

    CONSTRAINT "wedding_stats_pkey" PRIMARY KEY ("wedding_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_parties_link_token" ON "parties"("link_token");

-- CreateIndex
CREATE UNIQUE INDEX "uq_parties_wedding_id_id" ON "parties"("wedding_id", "id");

-- CreateIndex
CREATE INDEX "idx_guests_wedding_id_party_id" ON "guests"("wedding_id", "party_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_guests_wedding_id_id" ON "guests"("wedding_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_guests_party_id_id" ON "guests"("party_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_tags_wedding_id_id" ON "tags"("wedding_id", "id");

-- CreateIndex
CREATE INDEX "idx_party_tags_tag_id" ON "party_tags"("tag_id");

-- CreateIndex
CREATE INDEX "idx_party_tags_wedding_id" ON "party_tags"("wedding_id");

-- CreateIndex
CREATE INDEX "idx_guest_tags_tag_id" ON "guest_tags"("tag_id");

-- CreateIndex
CREATE INDEX "idx_guest_tags_wedding_id" ON "guest_tags"("wedding_id");

-- CreateIndex
CREATE INDEX "idx_wedding_stats_rsvp_percent" ON "wedding_stats"("rsvp_percent");

-- AddForeignKey
ALTER TABLE "parties" ADD CONSTRAINT "parties_wedding_id_fkey" FOREIGN KEY ("wedding_id") REFERENCES "weddings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guests" ADD CONSTRAINT "guests_wedding_id_fkey" FOREIGN KEY ("wedding_id") REFERENCES "weddings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guests" ADD CONSTRAINT "guests_wedding_id_party_id_fkey" FOREIGN KEY ("wedding_id", "party_id") REFERENCES "parties"("wedding_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_wedding_id_fkey" FOREIGN KEY ("wedding_id") REFERENCES "weddings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_tags" ADD CONSTRAINT "party_tags_wedding_id_fkey" FOREIGN KEY ("wedding_id") REFERENCES "weddings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_tags" ADD CONSTRAINT "party_tags_wedding_id_party_id_fkey" FOREIGN KEY ("wedding_id", "party_id") REFERENCES "parties"("wedding_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_tags" ADD CONSTRAINT "party_tags_wedding_id_tag_id_fkey" FOREIGN KEY ("wedding_id", "tag_id") REFERENCES "tags"("wedding_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_tags" ADD CONSTRAINT "guest_tags_wedding_id_fkey" FOREIGN KEY ("wedding_id") REFERENCES "weddings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_tags" ADD CONSTRAINT "guest_tags_wedding_id_guest_id_fkey" FOREIGN KEY ("wedding_id", "guest_id") REFERENCES "guests"("wedding_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_tags" ADD CONSTRAINT "guest_tags_wedding_id_tag_id_fkey" FOREIGN KEY ("wedding_id", "tag_id") REFERENCES "tags"("wedding_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wedding_stats" ADD CONSTRAINT "wedding_stats_wedding_id_fkey" FOREIGN KEY ("wedding_id") REFERENCES "weddings"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- SQL manual (ADR do Prisma; ADR de multi-tenant; Modelo de Dados, invariantes
-- 1, 2, 9, 11, 12 e 12.2; decisões 184, 186, 188, 189 e 191)

-- Contato do grupo (RN06; invariante 12.2): um convidado do próprio grupo. A FK
-- (id, contact_guest_id) → guests(party_id, id) garante o mesmo grupo (e, com
-- ele, o mesmo casamento). DEFERRABLE: mover o contato de grupo e trocar o
-- contato acontecem na mesma transação, e a checagem fica para o commit.
ALTER TABLE "parties" ADD CONSTRAINT "parties_contact_guest_fkey"
  FOREIGN KEY ("id", "contact_guest_id") REFERENCES "guests" ("party_id", "id")
  ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX "idx_parties_contact_guest_id" ON "parties" ("contact_guest_id")
  WHERE "contact_guest_id" IS NOT NULL;

-- Limites e formatos (Grupos RN04 e RN07; Tags RN02; decisões 184(12), 185(6)
-- e 189(9)). Nomes sem espaços nas pontas; o caso de uso limpa antes.
ALTER TABLE "parties" ADD CONSTRAINT "chk_parties_name"
  CHECK (char_length("name") BETWEEN 1 AND 80 AND "name" = btrim("name"));
ALTER TABLE "parties" ADD CONSTRAINT "chk_parties_internal_note"
  CHECK ("internal_note" IS NULL OR char_length("internal_note") <= 500);
ALTER TABLE "parties" ADD CONSTRAINT "chk_parties_plus_one_slots"
  CHECK ("plus_one_slots" BETWEEN 0 AND 5);
ALTER TABLE "parties" ADD CONSTRAINT "chk_parties_link_version"
  CHECK ("link_version" >= 1);
-- Nome nulo só na vaga de acompanhante vazia (invariante 9).
ALTER TABLE "guests" ADD CONSTRAINT "chk_guests_name"
  CHECK (("name" IS NULL AND "is_plus_one")
         OR ("name" IS NOT NULL AND char_length("name") BETWEEN 1 AND 80
             AND "name" = btrim("name")));
ALTER TABLE "guests" ADD CONSTRAINT "chk_guests_dietary_restriction"
  CHECK ("dietary_restriction" IS NULL OR char_length("dietary_restriction") <= 200);
-- Telefone em E.164 (RN04): + e de 8 a 15 dígitos, sem zero no código do país.
ALTER TABLE "guests" ADD CONSTRAINT "chk_guests_phone"
  CHECK ("phone" IS NULL OR "phone" ~ '^\+[1-9][0-9]{7,14}$');
-- E-mail guardado em minúsculas (RN04).
ALTER TABLE "guests" ADD CONSTRAINT "chk_guests_email"
  CHECK ("email" IS NULL OR "email"::text = lower("email"::text));
ALTER TABLE "tags" ADD CONSTRAINT "chk_tags_name"
  CHECK (char_length("name") BETWEEN 1 AND 40 AND "name" = btrim("name"));

-- Nome da tag único entre as ativas, sem diferenciar maiúsculas (Tags RN02;
-- decisão 185(1)); a tag na lixeira não impede outra com o mesmo nome.
CREATE UNIQUE INDEX "uq_tags_wedding_id_name_active"
  ON "tags" ("wedding_id", lower("name")) WHERE "deleted_at" IS NULL;

-- Busca e ordem sem acento (Grupos RN13; decisão 186(2)). unaccent() é STABLE
-- (depende do search_path); f_unaccent fixa o dicionário e o schema para poder
-- ser IMMUTABLE e entrar em índice.
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE FUNCTION f_unaccent(text) RETURNS text
  LANGUAGE sql
  IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;
CREATE INDEX "idx_parties_wedding_id_name_active"
  ON "parties" ("wedding_id", lower(f_unaccent("name")), "id") WHERE "deleted_at" IS NULL;
CREATE INDEX "idx_guests_wedding_id_name_active"
  ON "guests" ("wedding_id", lower(f_unaccent("name"))) WHERE "deleted_at" IS NULL;

-- Consultas quentes (Modelo de Dados, Índices e performance).
CREATE INDEX "idx_parties_wedding_id_delivery_status_active"
  ON "parties" ("wedding_id", "delivery_status") WHERE "deleted_at" IS NULL;
CREATE INDEX "idx_guests_wedding_id_rsvp_status_age_group_active"
  ON "guests" ("wedding_id", "rsvp_status", "age_group") WHERE "deleted_at" IS NULL;
-- Ordem do grupo (RN17).
CREATE INDEX "idx_guests_party_id_joined_party_at"
  ON "guests" ("party_id", "joined_party_at", "id");
-- Lixeira: a tela e o expurgo leem só o que está nela (Lixeira RN08 e RN10).
CREATE INDEX "idx_parties_wedding_id_deleted_at"
  ON "parties" ("wedding_id", "deleted_at") WHERE "deleted_at" IS NOT NULL;
CREATE INDEX "idx_guests_wedding_id_deleted_at"
  ON "guests" ("wedding_id", "deleted_at") WHERE "deleted_at" IS NOT NULL;
CREATE INDEX "idx_tags_wedding_id_deleted_at"
  ON "tags" ("wedding_id", "deleted_at") WHERE "deleted_at" IS NOT NULL;
CREATE INDEX "idx_guests_trash_batch_id"
  ON "guests" ("trash_batch_id") WHERE "trash_batch_id" IS NOT NULL;

-- RLS por vínculo (decisão 153): quem tem vínculo ativo com o casamento lê e
-- escreve a lista (manage_guests vale para qualquer vínculo, decisão 186(4)).
-- O limite de papel (trash_responded, só dono) fica no caso de uso. FORCE: nem
-- o dono da tabela escapa.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['parties', 'guests', 'tags', 'party_tags', 'guest_tags'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (wedding_id IN (SELECT active_wedding_ids()) '
      'AND (current_wedding_id() IS NULL OR wedding_id = current_wedding_id()))',
      t || '_member_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT WITH CHECK (wedding_id IN (SELECT active_wedding_ids()) '
      'AND (current_wedding_id() IS NULL OR wedding_id = current_wedding_id()))',
      t || '_member_insert', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['parties', 'guests', 'tags'] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE USING (wedding_id IN (SELECT active_wedding_ids()) '
      'AND (current_wedding_id() IS NULL OR wedding_id = current_wedding_id())) '
      'WITH CHECK (wedding_id IN (SELECT active_wedding_ids()))',
      t || '_member_update', t);
  END LOOP;
  -- Tirar a tag de um grupo ou convidado (Editar grupo) apaga o vínculo.
  FOREACH t IN ARRAY ARRAY['party_tags', 'guest_tags'] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE USING (wedding_id IN (SELECT active_wedding_ids()) '
      'AND (current_wedding_id() IS NULL OR wedding_id = current_wedding_id()))',
      t || '_member_delete', t);
  END LOOP;
END
$$;

-- A API não apaga grupo, convidado nem tag: a remoção é lógica (deleted_at), e
-- só o expurgo (backoffice) apaga de vez (Lixeira RN01 e RN10). Colunas que
-- ligam a linha a um casamento (id, wedding_id, created_at) são imutáveis pela
-- API; party_id muda no Mover de grupo (RN10).
REVOKE DELETE, UPDATE ON "parties", "guests", "tags" FROM kore_app;
REVOKE UPDATE ON "party_tags", "guest_tags" FROM kore_app;
GRANT UPDATE ("name", "internal_note", "link_token", "link_version", "link_regenerated_at",
              "contact_guest_id", "plus_one_slots", "delivery_status", "responded_at",
              "deleted_at", "updated_at")
  ON "parties" TO kore_app;
GRANT UPDATE ("party_id", "name", "email", "phone", "age_group", "dietary_restriction",
              "is_plus_one", "rsvp_status", "responded_at", "joined_party_at",
              "trash_batch_id", "deleted_at", "updated_at")
  ON "guests" TO kore_app;
GRANT UPDATE ("name", "color", "deleted_at", "updated_at") ON "tags" TO kore_app;

-- Números do casamento (RN16): a API lê e atualiza os contadores na transação
-- da escrita; a linha nasce pelo gatilho do cadastro e só sai com o casamento.
ALTER TABLE "wedding_stats" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "wedding_stats" FORCE ROW LEVEL SECURITY;
CREATE POLICY "wedding_stats_member_select" ON "wedding_stats" FOR SELECT
  USING ("wedding_id" IN (SELECT active_wedding_ids())
         AND (current_wedding_id() IS NULL OR "wedding_id" = current_wedding_id()));
CREATE POLICY "wedding_stats_member_update" ON "wedding_stats" FOR UPDATE
  USING ("wedding_id" IN (SELECT active_wedding_ids())
         AND (current_wedding_id() IS NULL OR "wedding_id" = current_wedding_id()))
  WITH CHECK ("wedding_id" IN (SELECT active_wedding_ids()));
REVOKE INSERT, UPDATE, DELETE ON "wedding_stats" FROM kore_app;
GRANT UPDATE ("guests_total", "confirmed", "declined", "pending", "adults_confirmed",
              "children_confirmed", "babies_confirmed", "parties_pending", "updated_at")
  ON "wedding_stats" TO kore_app;

-- Toda linha existe (decisão 186(3); decisão 188): o casamento novo ganha a
-- sua, zerada, no mesmo INSERT, venha de onde vier (cadastro do casal, Novo
-- casamento do indicador, seed). SECURITY DEFINER como kore_rls: no cadastro, a
-- pessoa ainda não tem vínculo, e a policy de inclusão não a deixaria gravar.
GRANT INSERT ON "wedding_stats" TO kore_rls;
CREATE FUNCTION create_wedding_stats() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  BEGIN
    INSERT INTO public.wedding_stats (wedding_id) VALUES (NEW.id);
    RETURN NEW;
  END
  $$;
ALTER FUNCTION create_wedding_stats() OWNER TO kore_rls;
REVOKE ALL ON FUNCTION create_wedding_stats() FROM PUBLIC;
CREATE TRIGGER "trg_weddings_create_stats" AFTER INSERT ON "weddings"
  FOR EACH ROW EXECUTE FUNCTION create_wedding_stats();

-- Casamentos que já existem: ainda não há convidados, então a linha é zerada.
INSERT INTO "wedding_stats" ("wedding_id") SELECT "id" FROM "weddings";
