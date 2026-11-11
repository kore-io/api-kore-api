-- Pré-visualização do site (S6 da F2; decisão 205, D3; decisão 207, item 8):
-- o token da prévia, de uso único, guardado só em hash.

-- CreateEnum
CREATE TYPE "site_preview_mode" AS ENUM ('visitor', 'party');

-- CreateTable
CREATE TABLE "site_preview_tokens" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "wedding_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "mode" "site_preview_mode" NOT NULL,
    "party_id" UUID,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),

    CONSTRAINT "site_preview_tokens_pkey" PRIMARY KEY ("id"),
    -- O grupo vem só no modo party, e sempre nele (RN02).
    CONSTRAINT "chk_site_preview_tokens_party" CHECK (("mode" = 'party') = ("party_id" IS NOT NULL)),
    -- SHA-256 em hex.
    CONSTRAINT "chk_site_preview_tokens_token_hash" CHECK ("token_hash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "uq_site_preview_tokens_token_hash" ON "site_preview_tokens"("token_hash");
CREATE INDEX "idx_site_preview_tokens_wedding_id" ON "site_preview_tokens"("wedding_id");
-- A rotina diária apaga os tokens com mais de 1 dia (Pré-visualização, modelo).
CREATE INDEX "idx_site_preview_tokens_created_at" ON "site_preview_tokens"("created_at");

ALTER TABLE "site_preview_tokens" ADD CONSTRAINT "site_preview_tokens_wedding_id_fkey" FOREIGN KEY ("wedding_id") REFERENCES "weddings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "site_preview_tokens" ADD CONSTRAINT "site_preview_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "site_preview_tokens" ADD CONSTRAINT "site_preview_tokens_wedding_id_party_id_fkey" FOREIGN KEY ("wedding_id", "party_id") REFERENCES "parties"("wedding_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS por vínculo (decisão 153), como as outras tabelas do site.
ALTER TABLE "site_preview_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "site_preview_tokens" FORCE ROW LEVEL SECURITY;
CREATE POLICY "site_preview_tokens_member_select" ON "site_preview_tokens" FOR SELECT
  USING ("wedding_id" IN (SELECT active_wedding_ids())
         AND (current_wedding_id() IS NULL OR "wedding_id" = current_wedding_id()));
CREATE POLICY "site_preview_tokens_member_insert" ON "site_preview_tokens" FOR INSERT
  WITH CHECK ("wedding_id" IN (SELECT active_wedding_ids())
              AND (current_wedding_id() IS NULL OR "wedding_id" = current_wedding_id())
              AND "user_id" = current_user_id());
CREATE POLICY "site_preview_tokens_member_update" ON "site_preview_tokens" FOR UPDATE
  USING ("wedding_id" IN (SELECT active_wedding_ids())
         AND (current_wedding_id() IS NULL OR "wedding_id" = current_wedding_id())
         AND "user_id" = current_user_id())
  WITH CHECK ("wedding_id" IN (SELECT active_wedding_ids()));

-- A API só marca o uso; apagar é da rotina diária e do expurgo (backoffice).
REVOKE DELETE, UPDATE ON "site_preview_tokens" FROM kore_app;
GRANT UPDATE ("used_at") ON "site_preview_tokens" TO kore_app;

-- A troca pelo cookie lê pelo hash antes de saber de quem é o token (o site
-- não tem sessão): função SECURITY DEFINER de kore_rls, que devolve o token e
-- o endereço do casamento. O vínculo e o uso são conferidos depois, na
-- transação com o userId do token (RLS).
GRANT SELECT ON "site_preview_tokens" TO kore_rls;
CREATE FUNCTION site_preview_by_hash(hash text) RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT jsonb_build_object(
      'id', t.id,
      'weddingId', t.wedding_id,
      'slug', w.slug,
      'userId', t.user_id,
      'mode', t.mode,
      'partyId', t.party_id,
      'expiresAt', t.expires_at,
      'usedAt', t.used_at
    )
    FROM public.site_preview_tokens t
    JOIN public.weddings w ON w.id = t.wedding_id
    WHERE t.token_hash = hash
  $$;
ALTER FUNCTION site_preview_by_hash(text) OWNER TO kore_rls;
REVOKE ALL ON FUNCTION site_preview_by_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION site_preview_by_hash(text) TO kore_app;
