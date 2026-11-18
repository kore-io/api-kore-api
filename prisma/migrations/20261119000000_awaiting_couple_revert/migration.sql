-- Decisão 297 (Convites de acesso; Meus casamentos e alertas RN08): sem convite
-- de dono pendente, o casamento volta de awaiting_couple a draft. Vale para o
-- cancelamento pela cerimonialista, para a recusa do casal e para o vencimento
-- do link (rotina diária). Uma função só, com a trava do casamento (a mesma do
-- envio de convites) e o log wedding.awaiting_couple_reverted: actorKind user
-- com a pessoa da requisição (app.user_id), system sem ela (recusa e rotina).
-- p_now é o relógio do vencimento (a rotina injeta o dela).
CREATE FUNCTION revert_awaiting_couple(p_wedding_id uuid, p_cause text, p_now timestamptz)
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
ALTER FUNCTION revert_awaiting_couple(uuid, text, timestamptz) OWNER TO kore_rls;
REVOKE ALL ON FUNCTION revert_awaiting_couple(uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION revert_awaiting_couple(uuid, text, timestamptz) TO kore_app, kore_backoffice;
