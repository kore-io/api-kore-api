-- Ver como o casal (Backoffice - acesso RN08; revisão técnica B9-1, decisão
-- 231): as leituras da sessão de suporte rodam no papel kore_support, que só
-- tem SELECT, no padrão do kore_party: SET LOCAL ROLE kore_support e
-- app.wedding_id = o casamento da sessão, com policies *_support_select por
-- wedding_id = current_wedding_id(). Nunca o id de um dono em app.user_id e
-- nunca a conexão do backoffice nas telas do casal. Fora: as leituras pessoais
-- do dono (notificações, preferências, push), o log, os alertas, o gateway, as
-- comissões e a própria support_sessions.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kore_support') THEN
    CREATE ROLE kore_support NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
-- O kore_app entra no papel (SET ROLE) sem herdar os grants dele.
GRANT kore_support TO kore_app WITH INHERIT FALSE, SET TRUE;
GRANT USAGE ON SCHEMA public TO kore_support;

-- As funções das policies (avaliadas também neste papel; sem app.user_id,
-- as de vínculo devolvem vazio) e as de leitura das telas do casal. Todas
-- STABLE; nenhuma função de escrita.
GRANT EXECUTE ON FUNCTION
  active_wedding_ids(),
  current_party_id(),
  current_planner_id(),
  current_referrer_id(),
  current_user_id(),
  current_wedding_id(),
  own_referrer_ids(),
  owned_wedding_ids(),
  planner_ownerless_wedding_ids(),
  planner_unclaimed_wedding_ids(),
  referred_wedding_ids(),
  session_wedding_planner_collaborator(),
  session_wedding_planner_credit(),
  unclaimed_created_wedding_ids(),
  wedding_awaiting_payment(uuid),
  wedding_partner_names(uuid),
  wedding_site_state(uuid)
  TO kore_support;

-- O casamento da sessão.
GRANT SELECT ON "weddings" TO kore_support;
CREATE POLICY "weddings_support_select" ON "weddings" FOR SELECT TO kore_support
  USING ("id" = current_wedding_id());

-- Os nomes de quem tem acesso (a users não tem RLS; o papel só lê).
GRANT SELECT ON "users" TO kore_support;

GRANT SELECT ON "access_invitations" TO kore_support;
CREATE POLICY "access_invitations_support_select" ON "access_invitations" FOR SELECT TO kore_support
  USING ("wedding_id" = current_wedding_id());
GRANT SELECT ON "guest_responses" TO kore_support;
CREATE POLICY "guest_responses_support_select" ON "guest_responses" FOR SELECT TO kore_support
  USING ("wedding_id" = current_wedding_id());
GRANT SELECT ON "guest_tags" TO kore_support;
CREATE POLICY "guest_tags_support_select" ON "guest_tags" FOR SELECT TO kore_support
  USING ("wedding_id" = current_wedding_id());
GRANT SELECT ON "guests" TO kore_support;
CREATE POLICY "guests_support_select" ON "guests" FOR SELECT TO kore_support
  USING ("wedding_id" = current_wedding_id());
GRANT SELECT ON "memberships" TO kore_support;
CREATE POLICY "memberships_support_select" ON "memberships" FOR SELECT TO kore_support
  USING ("wedding_id" = current_wedding_id());
GRANT SELECT ON "message_templates" TO kore_support;
CREATE POLICY "message_templates_support_select" ON "message_templates" FOR SELECT TO kore_support
  USING ("wedding_id" = current_wedding_id());
GRANT SELECT ON "parties" TO kore_support;
CREATE POLICY "parties_support_select" ON "parties" FOR SELECT TO kore_support
  USING ("wedding_id" = current_wedding_id());
GRANT SELECT ON "partners" TO kore_support;
CREATE POLICY "partners_support_select" ON "partners" FOR SELECT TO kore_support
  USING ("wedding_id" = current_wedding_id());
GRANT SELECT ON "party_deliveries" TO kore_support;
CREATE POLICY "party_deliveries_support_select" ON "party_deliveries" FOR SELECT TO kore_support
  USING ("wedding_id" = current_wedding_id());
GRANT SELECT ON "party_tags" TO kore_support;
CREATE POLICY "party_tags_support_select" ON "party_tags" FOR SELECT TO kore_support
  USING ("wedding_id" = current_wedding_id());
GRANT SELECT ON "payments" TO kore_support;
CREATE POLICY "payments_support_select" ON "payments" FOR SELECT TO kore_support
  USING ("wedding_id" = current_wedding_id());
GRANT SELECT ON "rsvp_submissions" TO kore_support;
CREATE POLICY "rsvp_submissions_support_select" ON "rsvp_submissions" FOR SELECT TO kore_support
  USING ("wedding_id" = current_wedding_id());
GRANT SELECT ON "section_contents" TO kore_support;
CREATE POLICY "section_contents_support_select" ON "section_contents" FOR SELECT TO kore_support
  USING ("wedding_id" = current_wedding_id());
GRANT SELECT ON "sections" TO kore_support;
CREATE POLICY "sections_support_select" ON "sections" FOR SELECT TO kore_support
  USING ("wedding_id" = current_wedding_id());
GRANT SELECT ON "site_images" TO kore_support;
CREATE POLICY "site_images_support_select" ON "site_images" FOR SELECT TO kore_support
  USING ("wedding_id" = current_wedding_id());
GRANT SELECT ON "tags" TO kore_support;
CREATE POLICY "tags_support_select" ON "tags" FOR SELECT TO kore_support
  USING ("wedding_id" = current_wedding_id());
GRANT SELECT ON "wedding_stats" TO kore_support;
CREATE POLICY "wedding_stats_support_select" ON "wedding_stats" FOR SELECT TO kore_support
  USING ("wedding_id" = current_wedding_id());
GRANT SELECT ON "courtesy_extensions" TO kore_support;
CREATE POLICY "courtesy_extensions_support_select" ON "courtesy_extensions" FOR SELECT TO kore_support
  USING ("wedding_id" = current_wedding_id());

-- O tipo de perfil de quem tem acesso (a lista de Colaboradores): só os
-- indicadores que são membros do casamento da sessão.
GRANT SELECT ON "referrers" TO kore_support;
CREATE POLICY "referrers_support_select" ON "referrers" FOR SELECT TO kore_support
  USING ("user_id" IN (SELECT m."user_id" FROM "memberships" m
                       WHERE m."wedding_id" = current_wedding_id()));
