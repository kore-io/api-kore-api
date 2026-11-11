-- Imagens do site (S4 da F2; decisão 207, itens 1 a 3): o SiteImage nasce em
-- `uploading` na autorização de envio e fica `ready` depois do processamento.

-- CreateEnum
CREATE TYPE "site_image_status" AS ENUM ('uploading', 'processing', 'ready', 'failed');

-- CreateTable
CREATE TABLE "site_images" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "wedding_id" UUID NOT NULL,
    "status" "site_image_status" NOT NULL DEFAULT 'uploading',
    "storage_key" TEXT NOT NULL,
    "thumb_key" TEXT,
    "og_key" TEXT,
    "size_bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "uploaded_by_user_id" UUID,
    "ready_at" TIMESTAMPTZ(3),
    "unused_since" TIMESTAMPTZ(3),

    CONSTRAINT "site_images_pkey" PRIMARY KEY ("id"),
    -- Até 4 MB (RN04 e RN05).
    CONSTRAINT "chk_site_images_size_bytes" CHECK ("size_bytes" BETWEEN 1 AND 4194304),
    -- Pronta tem as versões, as medidas e a data (RN05).
    CONSTRAINT "chk_site_images_ready" CHECK (
      "status" <> 'ready'
      OR ("thumb_key" IS NOT NULL AND "og_key" IS NOT NULL AND "width" IS NOT NULL
          AND "height" IS NOT NULL AND "ready_at" IS NOT NULL)
    )
);

-- Lista do casamento e contagem do limite (RN07) e a rotina de limpeza (RN08).
CREATE INDEX "idx_site_images_wedding_id_status" ON "site_images"("wedding_id", "status");
CREATE INDEX "idx_site_images_status_unused_since" ON "site_images"("status", "unused_since");
-- A capa terá FK composta (wedding_id, cover_image_id) → (wedding_id, id) (RN10).
CREATE UNIQUE INDEX "uq_site_images_wedding_id_id" ON "site_images"("wedding_id", "id");

ALTER TABLE "site_images" ADD CONSTRAINT "site_images_wedding_id_fkey" FOREIGN KEY ("wedding_id") REFERENCES "weddings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "site_images" ADD CONSTRAINT "site_images_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS por vínculo (decisão 153), como as tabelas da lista (migration guests):
-- manage_site vale para qualquer vínculo (Dados básicos RN04). FORCE: nem o
-- dono da tabela escapa.
ALTER TABLE "site_images" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "site_images" FORCE ROW LEVEL SECURITY;
CREATE POLICY "site_images_member_select" ON "site_images" FOR SELECT
  USING ("wedding_id" IN (SELECT active_wedding_ids())
         AND (current_wedding_id() IS NULL OR "wedding_id" = current_wedding_id()));
CREATE POLICY "site_images_member_insert" ON "site_images" FOR INSERT
  WITH CHECK ("wedding_id" IN (SELECT active_wedding_ids())
              AND (current_wedding_id() IS NULL OR "wedding_id" = current_wedding_id()));
CREATE POLICY "site_images_member_update" ON "site_images" FOR UPDATE
  USING ("wedding_id" IN (SELECT active_wedding_ids())
         AND (current_wedding_id() IS NULL OR "wedding_id" = current_wedding_id()))
  WITH CHECK ("wedding_id" IN (SELECT active_wedding_ids()));

-- A API não apaga imagem (não há rota de excluir; decisão 207, item 2): só a
-- rotina de limpeza e o expurgo, pelo backoffice. As chaves, o casamento e
-- quem enviou não mudam.
REVOKE DELETE, UPDATE ON "site_images" FROM kore_app;
GRANT UPDATE ("status", "thumb_key", "og_key", "size_bytes", "width", "height", "ready_at",
              "unused_since", "updated_at")
  ON "site_images" TO kore_app;
