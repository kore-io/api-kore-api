-- Dono que sai do casamento (RN07 de Papéis; decisão 177, item 10): o noivo
-- dele perde o login, para outra pessoa poder entrar por convite de parceiro.
-- A API não altera partners.user_id (só o aceite do convite preenche); esta
-- função solta só o login da própria pessoa, e só depois de ela ter saído.
CREATE FUNCTION release_partner_login(p_wedding_id uuid) RETURNS void
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    UPDATE public.partners SET user_id = NULL
    WHERE wedding_id = p_wedding_id
      AND user_id = public.current_user_id()
      AND NOT EXISTS (SELECT 1 FROM public.memberships m
                      WHERE m.wedding_id = p_wedding_id
                        AND m.user_id = public.current_user_id()
                        AND m.removed_at IS NULL)
  $$;
ALTER FUNCTION release_partner_login(uuid) OWNER TO kore_rls;
REVOKE ALL ON FUNCTION release_partner_login(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION release_partner_login(uuid) TO kore_app;
