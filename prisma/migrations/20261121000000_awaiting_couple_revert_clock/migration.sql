-- Decisão 297, sugestão do Crivo (defesa em profundidade): o p_now da API não
-- passa do relógio do banco. Só o corpo muda; o dono (kore_rls) e os GRANTs
-- seguem os da 20261119000000 (o CREATE OR REPLACE os mantém).
CREATE OR REPLACE FUNCTION revert_awaiting_couple(p_wedding_id uuid, p_cause text, p_now timestamptz)
  RETURNS boolean
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
DECLARE
  v_actor uuid := public.current_user_id();
  v_reverted boolean;
BEGIN
  -- A API (a conexão kore_api, membro do kore_app) fica presa ao relógio do
  -- banco: um p_now adiantado não vence um link ainda no prazo. A rotina
  -- (kore_routines, pelo kore_backoffice) segue com o relógio injetado. O
  -- session_user não muda no SECURITY DEFINER nem no SET ROLE; o pg_has_role
  -- diz sim a todo superusuário, que fica de fora (sugestão do Crivo na 297).
  IF pg_has_role(session_user, 'kore_app', 'MEMBER')
     AND NOT (SELECT r.rolsuper FROM pg_roles r WHERE r.rolname = session_user) THEN
    p_now := least(p_now, now());
  END IF;
  IF p_cause NOT IN ('revoked', 'declined', 'expired') THEN
    RAISE EXCEPTION 'revert_awaiting_couple: causa inválida %', p_cause;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('wedding:' || p_wedding_id::text, 0));
  UPDATE public.weddings w
  SET status = 'draft', updated_at = clock_timestamp()
  WHERE w.id = p_wedding_id AND w.status = 'awaiting_couple'
    AND NOT EXISTS (
      SELECT 1 FROM public.access_invitations i
      WHERE i.wedding_id = w.id AND i.role = 'owner'
        AND i.accepted_at IS NULL AND i.declined_at IS NULL
        AND i.revoked_at IS NULL AND i.superseded_at IS NULL
        AND i.expires_at > p_now)
  RETURNING true INTO v_reverted;
  IF v_reverted IS NOT TRUE THEN
    RETURN false;
  END IF;
  INSERT INTO public.application_logs
    (id, created_at, wedding_id, actor_kind, actor_user_id, action, entity_type, entity_id, data)
  VALUES (public.log_uuid_v7(), clock_timestamp(), p_wedding_id,
          CASE WHEN v_actor IS NULL THEN 'system' ELSE 'user' END::application_log_actor,
          v_actor, 'wedding.awaiting_couple_reverted', 'wedding', p_wedding_id::text,
          jsonb_build_object('cause', p_cause));
  RETURN true;
END
$$;
