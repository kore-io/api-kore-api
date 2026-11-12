-- Assinatura (revisão do PR 73-assinatura, Crivo): a wedding_planner_collaborator
-- e a wedding_planner_credit recebiam o id do casamento e tinham EXECUTE ao
-- kore_app, então a API respondia o nome da assessoria de qualquer casamento
-- (um rascunho alheio, por exemplo). O kore_app perde o EXECUTE delas e passa
-- a usar duas funções sem parâmetro de id, só do casamento da transação
-- (app.wedding_id) e só com vínculo ativo da pessoa (app.user_id), no molde
-- das outras leituras fora da RLS (decisão 224). As leituras públicas
-- (site_public_by_slug e access_invitation_by_token) seguem chamando as
-- funções por dentro, como kore_rls.
REVOKE EXECUTE ON FUNCTION wedding_planner_credit(uuid) FROM kore_app;
REVOKE EXECUTE ON FUNCTION wedding_planner_collaborator(uuid) FROM kore_app;

-- A prévia do site (Assinatura RN04).
CREATE FUNCTION session_wedding_planner_credit() RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT public.wedding_planner_credit(public.current_wedding_id())
    WHERE public.current_wedding_id() IN (SELECT public.active_wedding_ids())
  $$;
ALTER FUNCTION session_wedding_planner_credit() OWNER TO kore_rls;
REVOKE ALL ON FUNCTION session_wedding_planner_credit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION session_wedding_planner_credit() TO kore_app;

-- O Editor (Assinatura RN05 e RN06).
CREATE FUNCTION session_wedding_planner_collaborator() RETURNS TABLE (
  credit_name text,
  hidden_by_kore boolean,
  show_planner_credit boolean
)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT c.credit_name, c.hidden_by_kore, c.show_planner_credit
    FROM public.wedding_planner_collaborator(public.current_wedding_id()) c
    WHERE public.current_wedding_id() IN (SELECT public.active_wedding_ids())
  $$;
ALTER FUNCTION session_wedding_planner_collaborator() OWNER TO kore_rls;
REVOKE ALL ON FUNCTION session_wedding_planner_collaborator() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION session_wedding_planner_collaborator() TO kore_app;
