-- A chave e a URL pública da imagem do site passam a ser aleatórias (decisão
-- 229(f)): o id é um UUIDv7, que revela a hora do envio. O token é gerado pela
-- API (128 bits). As imagens que já existem ficam onde estão: o token delas é o
-- próprio id, que já é a chave dos arquivos.
ALTER TABLE "site_images" ADD COLUMN "key_token" TEXT;
UPDATE "site_images" SET "key_token" = "id"::text;
ALTER TABLE "site_images" ALTER COLUMN "key_token" SET NOT NULL;
CREATE UNIQUE INDEX "uq_site_images_key_token" ON "site_images"("key_token");
