-- Site do casal (F2): as colunas do site no casamento (Dados básicos e
-- Aparência), as seções com o conteúdo (Seções do site) e a capa (Imagens do site).

-- CreateEnum
CREATE TYPE "section_type" AS ENUM ('story', 'countdown', 'ceremony', 'lodging', 'dress_code', 'faq', 'gallery', 'gifts', 'messages');

-- AlterTable
ALTER TABLE "weddings" ADD COLUMN     "accent_color" TEXT DEFAULT '#7A8B69',
ADD COLUMN     "appearance_set_at" TIMESTAMPTZ(3),
ADD COLUMN     "background_mode" TEXT DEFAULT 'cream',
ADD COLUMN     "contact_email" CITEXT,
ADD COLUMN     "contact_whatsapp" TEXT,
ADD COLUMN     "cover_image_id" UUID,
ADD COLUMN     "font_pair_key" TEXT DEFAULT 'romantico',
ADD COLUMN     "locales" TEXT[] NOT NULL DEFAULT ARRAY['pt-BR']::TEXT[],
ADD COLUMN     "primary_color" TEXT DEFAULT '#A94F37',
ADD COLUMN     "published_at" TIMESTAMPTZ(3),
ADD COLUMN     "site_updated_at" TIMESTAMPTZ(3),
ADD COLUMN     "starter_palette_key" TEXT DEFAULT 'terracota';

-- CreateTable
CREATE TABLE "sections" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "wedding_id" UUID NOT NULL,
    "type" "section_type" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,
    "title" TEXT,

    CONSTRAINT "sections_pkey" PRIMARY KEY ("id"),
    -- Título até 80 (Seções RN05 a RN10).
    CONSTRAINT "chk_sections_title" CHECK ("title" IS NULL OR char_length("title") <= 80)
);

-- CreateTable
CREATE TABLE "section_contents" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "wedding_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "content" JSONB NOT NULL,

    CONSTRAINT "section_contents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_section_contents_content" CHECK (jsonb_typeof("content") = 'object')
);

CREATE UNIQUE INDEX "uq_sections_wedding_id_type" ON "sections"("wedding_id", "type");
CREATE UNIQUE INDEX "uq_sections_wedding_id_id" ON "sections"("wedding_id", "id");
CREATE INDEX "idx_section_contents_wedding_id" ON "section_contents"("wedding_id");
CREATE UNIQUE INDEX "uq_section_contents_section_id_locale" ON "section_contents"("section_id", "locale");

ALTER TABLE "sections" ADD CONSTRAINT "sections_wedding_id_fkey" FOREIGN KEY ("wedding_id") REFERENCES "weddings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "section_contents" ADD CONSTRAINT "section_contents_wedding_id_fkey" FOREIGN KEY ("wedding_id") REFERENCES "weddings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "section_contents" ADD CONSTRAINT "section_contents_wedding_id_section_id_fkey" FOREIGN KEY ("wedding_id", "section_id") REFERENCES "sections"("wedding_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SQL manual ----------------------------------------------------------------

-- Capa (Imagens do site RN10): só imagem do mesmo casamento. Imagem apagada
-- (pela rotina ou pelo expurgo) tira a capa, sem mexer no id do casamento.
ALTER TABLE "weddings" ADD CONSTRAINT "weddings_cover_image_fkey"
  FOREIGN KEY ("id", "cover_image_id") REFERENCES "site_images" ("wedding_id", "id")
  ON DELETE SET NULL ("cover_image_id");

-- Aparência (Aparência do site RN01): o catálogo fixo e as cores em #RRGGBB
-- maiúsculo; fundo e texto não têm cor livre. Nulas só na lápide (Imagens RN11).
-- Os idiomas (F10) ficam ['pt-BR'] também na lápide: não são dado do casal.
ALTER TABLE "weddings" ADD CONSTRAINT "chk_weddings_font_pair_key"
  CHECK ("font_pair_key" IN ('romantico', 'classico', 'leve', 'moderno'));
ALTER TABLE "weddings" ADD CONSTRAINT "chk_weddings_starter_palette_key"
  CHECK ("starter_palette_key" IN ('terracota', 'salvia', 'rose', 'marfim', 'marinho', 'areia',
                                   'por-do-sol', 'grafite', 'noite'));
ALTER TABLE "weddings" ADD CONSTRAINT "chk_weddings_background_mode"
  CHECK ("background_mode" IN ('light', 'cream', 'dark'));
ALTER TABLE "weddings" ADD CONSTRAINT "chk_weddings_primary_color"
  CHECK ("primary_color" ~ '^#[0-9A-F]{6}$');
ALTER TABLE "weddings" ADD CONSTRAINT "chk_weddings_accent_color"
  CHECK ("accent_color" ~ '^#[0-9A-F]{6}$');
ALTER TABLE "weddings" ADD CONSTRAINT "chk_weddings_site_tombstone"
  CHECK ("status" = 'purged' OR ("font_pair_key" IS NOT NULL AND "primary_color" IS NOT NULL
         AND "accent_color" IS NOT NULL AND "background_mode" IS NOT NULL));
-- Contato do casal (Dados básicos RN08): e-mail até 254 e WhatsApp em E.164.
ALTER TABLE "weddings" ADD CONSTRAINT "chk_weddings_contact_email"
  CHECK ("contact_email" IS NULL OR char_length("contact_email") <= 254);
ALTER TABLE "weddings" ADD CONSTRAINT "chk_weddings_contact_whatsapp"
  CHECK ("contact_whatsapp" IS NULL OR "contact_whatsapp" ~ '^\+[1-9][0-9]{7,14}$');

-- A lápide (Imagens do site RN11): os casamentos já expurgados ficam sem a
-- aparência, que acabou de nascer com os padrões.
UPDATE "weddings" SET "font_pair_key" = NULL, "starter_palette_key" = NULL,
  "primary_color" = NULL, "accent_color" = NULL, "background_mode" = NULL
WHERE "status" = 'purged';

-- O Editor grava estas colunas (o UPDATE da tabela é revogado de kore_app,
-- migration weddings). A data, a UF e o endereço já tinham o GRANT.
GRANT UPDATE ("contact_email", "contact_whatsapp", "cover_image_id", "site_updated_at",
              "published_at", "font_pair_key", "starter_palette_key", "primary_color",
              "accent_color", "background_mode", "appearance_set_at")
  ON "weddings" TO kore_app;

-- RLS por vínculo (decisão 153), como as tabelas da lista (migration guests):
-- manage_site vale para qualquer vínculo. FORCE: nem o dono da tabela escapa.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sections', 'section_contents'] LOOP
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
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE USING (wedding_id IN (SELECT active_wedding_ids()) '
      'AND (current_wedding_id() IS NULL OR wedding_id = current_wedding_id())) '
      'WITH CHECK (wedding_id IN (SELECT active_wedding_ids()))',
      t || '_member_update', t);
  END LOOP;
END
$$;

-- A API não apaga seção (desligar só esconde, RN11) e não troca tipo, ordem
-- nem casamento; o conteúdo é regravado inteiro (RN13).
REVOKE DELETE, UPDATE ON "sections", "section_contents" FROM kore_app;
GRANT UPDATE ("enabled", "title", "updated_at") ON "sections" TO kore_app;
GRANT UPDATE ("content", "updated_at") ON "section_contents" TO kore_app;

-- As 6 seções da F2 nascem com o casamento (Seções RN02; decisão 205, D9), na
-- mesma função do WeddingStats: SECURITY DEFINER como kore_rls, porque no
-- cadastro a pessoa ainda não tem vínculo. Corpo vazio: o Kore não escreve na
-- voz do casal.
GRANT INSERT ON "sections", "section_contents" TO kore_rls;

CREATE FUNCTION create_wedding_sections(wedding uuid) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    s record;
    section uuid;
  BEGIN
    FOR s IN
      SELECT * FROM (VALUES
        ('story'::section_type, 1, false, 'Nossa história', '{"text": "", "imageIds": []}'::jsonb),
        ('countdown', 2, true, NULL, '{}'),
        ('ceremony', 3, true, 'Cerimônia & Recepção', '{"venues": []}'),
        ('lodging', 4, false, 'Hospedagem e transporte', '{"text": ""}'),
        ('dress_code', 5, false, 'Dress code', '{"text": "", "imageId": null}'),
        ('faq', 6, false, 'Perguntas frequentes', '{"items": []}')
      ) AS v(type, position, enabled, title, content)
    LOOP
      section := gen_random_uuid();
      INSERT INTO public.sections (id, wedding_id, type, position, enabled, title, updated_at)
        VALUES (section, wedding, s.type, s.position, s.enabled, s.title, now());
      INSERT INTO public.section_contents (id, wedding_id, section_id, locale, content, updated_at)
        VALUES (gen_random_uuid(), wedding, section, 'pt-BR', s.content, now());
    END LOOP;
  END
  $$;

-- Casamentos que já existem (menos a lápide): as mesmas 6 seções.
SELECT create_wedding_sections("id") FROM "weddings" WHERE "status" <> 'purged';

ALTER FUNCTION create_wedding_sections(uuid) OWNER TO kore_rls;
REVOKE ALL ON FUNCTION create_wedding_sections(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION create_wedding_stats() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  BEGIN
    INSERT INTO public.wedding_stats (wedding_id) VALUES (NEW.id);
    PERFORM public.create_wedding_sections(NEW.id);
    RETURN NEW;
  END
  $$;

-- Slugs reservados (Dados básicos RN07; decisão 205, D19): a lista nova pode
-- pegar um endereço já em uso. A migration não muda nada nele; só avisa no log
-- da migration, para o orquestrador decidir caso a caso.
DO $$
DECLARE
  w record;
BEGIN
  FOR w IN
    SELECT "id", "slug" FROM "weddings"
    WHERE lower("slug"::text) IN ('previa', 'simule', 'precos', 'como-funciona', 'comparar',
      'cerimonialistas', 'faq', 'cadastro', 'i', 'public', 'perfis', 'sessao-expirada',
      'vendedor', 'assets', 'sitemap', 'robots', 'favicon')
  LOOP
    RAISE NOTICE 'Casamento % usa o endereço reservado "%".', w."id", w."slug";
  END LOOP;
END
$$;
