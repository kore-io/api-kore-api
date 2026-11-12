-- Indicador (revisão do PR 73-modelo, Crivo): a RLS de planners confia no
-- Referrer da pessoa (own_referrer_ids, current_referrer_id), então o
-- Referrer também passa a ter RLS. A leitura segue livre (o destaque do
-- GET /v1/referrals/{código} e o aceite); a inclusão, só da própria pessoa
-- (o perfil mínimo do aceite e o cadastro de cerimonialista). Alterar e apagar
-- continuam sem grant ao kore_app (migration referrals): são do Admin.
ALTER TABLE "referrers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "referrers" FORCE ROW LEVEL SECURITY;
CREATE POLICY "referrers_public_select" ON "referrers" FOR SELECT USING (true);
CREATE POLICY "referrers_own_insert" ON "referrers" FOR INSERT
  WITH CHECK ("user_id" = current_user_id());
