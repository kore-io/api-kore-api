-- Aceite e recusa do convite de acesso (Convites RN06 a RN12, RN14; decisões
-- 153 item 4 e 172). Quem abre o convite ainda não tem vínculo com o casamento,
-- então a RLS não deixa ler nem gravar nada dele: o token do link é a
-- credencial, e estas funções SECURITY DEFINER só agem a partir do hash dele.
-- Mesmo padrão das da RLS: donas do kore_rls, search_path fixo, sem PUBLIC.

GRANT SELECT ON "access_invitations", "partners", "users", "referrers", "planners",
  "referral_settings" TO kore_rls;
GRANT INSERT ON "memberships" TO kore_rls;
GRANT UPDATE ("accepted_at", "accepted_by_user_id", "accepted_for_email", "declined_at")
  ON "access_invitations" TO kore_rls;
GRANT UPDATE ("user_id", "title") ON "partners" TO kore_rls;
GRANT UPDATE ("referrer_id", "referral_source") ON "weddings" TO kore_rls;

-- O convite pelo hash do token, com o que a tela e o aceite precisam ver
-- (RN06): o casamento, quem convidou, o indicador e os vínculos ativos.
-- Nulo quando o hash não existe. Não decide nada: o domínio decide.
CREATE FUNCTION access_invitation_by_token(p_token_hash text) RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT jsonb_build_object(
      'id', i.id,
      'weddingId', i.wedding_id,
      'kind', i.kind,
      'email', i.email,
      'role', i.role,
      'expiresAt', i.expires_at,
      'acceptedAt', i.accepted_at,
      'declinedAt', i.declined_at,
      'revokedAt', i.revoked_at,
      'supersededAt', i.superseded_at,
      'wedding', jsonb_build_object(
        'status', w.status,
        'eventDate', w.event_date,
        'city', w.city,
        'state', w.state,
        'createdByUserId', w.created_by_user_id,
        'referralSource', w.referral_source,
        'partners', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                       'slot', p.slot, 'displayName', p.display_name,
                       'title', p.title, 'userId', p.user_id) ORDER BY p.slot), '[]'::jsonb)
                     FROM public.partners p WHERE p.wedding_id = w.id),
        'activeOwners', (SELECT count(*) FROM public.memberships m
                         WHERE m.wedding_id = w.id AND m.role = 'owner' AND m.removed_at IS NULL),
        'activeCollaborators', (SELECT count(*) FROM public.memberships m
                                WHERE m.wedding_id = w.id AND m.role = 'collaborator'
                                  AND m.removed_at IS NULL)
      ),
      'inviter', jsonb_build_object(
        'userId', u.id,
        'email', u.email,
        'name', u.name,
        'partnerName', (SELECT p.display_name FROM public.partners p
                        WHERE p.wedding_id = w.id AND p.user_id = u.id),
        'referrerKind', ur.kind,
        'creditName', up.credit_name
      ),
      'referrer', CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object(
        'referrerId', r.id,
        'userId', r.user_id,
        'referralCode', r.referral_code,
        'kind', r.kind,
        'status', r.status,
        'accountStatus', ru.status,
        'displayName', CASE WHEN r.kind = 'planner' THEN rp.credit_name ELSE ru.name END,
        'referralDiscountEnabled', r.referral_discount_enabled
      ) END,
      'referralDiscountPercent', (SELECT s.referral_discount_percent FROM public.referral_settings s)
    )
    FROM public.access_invitations i
    JOIN public.weddings w ON w.id = i.wedding_id
    JOIN public.users u ON u.id = i.invited_by_user_id
    LEFT JOIN public.referrers ur ON ur.user_id = u.id
    LEFT JOIN public.planners up ON up.referrer_id = ur.id
    LEFT JOIN public.referrers r ON r.id = w.referrer_id
    LEFT JOIN public.users ru ON ru.id = r.user_id
    LEFT JOIN public.planners rp ON rp.referrer_id = r.id
    WHERE i.token_hash = p_token_hash
  $$;
ALTER FUNCTION access_invitation_by_token(text) OWNER TO kore_rls;
REVOKE ALL ON FUNCTION access_invitation_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION access_invitation_by_token(text) TO kore_app;

-- Grava o aceite (RN03, RN08 a RN10, RN14) para a pessoa da transação. As
-- regras de negócio são checadas antes pelo domínio, sob lock; aqui ficam as
-- barreiras que o banco garante: convite pendente e no prazo, uma vez só (FOR
-- UPDATE), no máximo 2 donos e 1 colaborador, e o noivo escolhido ainda sem
-- login. Na RN10, o casamento sem indicador fica atribuído ao cerimonialista
-- que aceita (invited_before_payment; sem cobrança na F0, decisão 172).
CREATE FUNCTION accept_access_invitation(
  p_token_hash text,
  p_membership_id uuid,
  p_partner_slot smallint,
  p_partner_title partner_title,
  p_accepted_for_email citext
) RETURNS TABLE (wedding_id uuid, attributed boolean)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_user uuid := public.current_user_id();
    v_invitation public.access_invitations%ROWTYPE;
    v_referrer uuid;
    v_attributed boolean := false;
  BEGIN
    IF v_user IS NULL THEN
      RAISE EXCEPTION 'accept_access_invitation: no user' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_invitation FROM public.access_invitations
      WHERE token_hash = p_token_hash FOR UPDATE;
    IF NOT FOUND OR v_invitation.accepted_at IS NOT NULL OR v_invitation.declined_at IS NOT NULL
       OR v_invitation.revoked_at IS NOT NULL OR v_invitation.superseded_at IS NOT NULL
       OR v_invitation.expires_at <= now() THEN
      RAISE EXCEPTION 'accept_access_invitation: invitation not pending' USING ERRCODE = 'P0001';
    END IF;
    PERFORM 1 FROM public.weddings WHERE id = v_invitation.wedding_id FOR UPDATE;

    IF v_invitation.role = 'owner' THEN
      IF (SELECT count(*) FROM public.memberships m WHERE m.wedding_id = v_invitation.wedding_id
            AND m.role = 'owner' AND m.removed_at IS NULL) >= 2 THEN
        RAISE EXCEPTION 'accept_access_invitation: owners full' USING ERRCODE = 'P0001';
      END IF;
      UPDATE public.partners SET user_id = v_user, title = coalesce(p_partner_title, title)
        WHERE partners.wedding_id = v_invitation.wedding_id AND slot = p_partner_slot
          AND user_id IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'accept_access_invitation: partner taken' USING ERRCODE = 'P0001';
      END IF;
    ELSIF EXISTS (SELECT 1 FROM public.memberships m WHERE m.wedding_id = v_invitation.wedding_id
                    AND m.role = 'collaborator' AND m.removed_at IS NULL) THEN
      RAISE EXCEPTION 'accept_access_invitation: planner already' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.memberships (id, wedding_id, user_id, role)
      VALUES (p_membership_id, v_invitation.wedding_id, v_user, v_invitation.role);
    UPDATE public.access_invitations
      SET accepted_at = now(), accepted_by_user_id = v_user, accepted_for_email = p_accepted_for_email
      WHERE id = v_invitation.id;

    IF v_invitation.kind = 'planner' THEN
      SELECT r.id INTO v_referrer FROM public.referrers r
        WHERE r.user_id = v_user AND r.kind = 'planner' AND r.status = 'active';
      IF v_referrer IS NOT NULL THEN
        UPDATE public.weddings SET referrer_id = v_referrer, referral_source = 'invited_before_payment'
          WHERE id = v_invitation.wedding_id AND referrer_id IS NULL;
        v_attributed := FOUND;
      END IF;
    END IF;

    RETURN QUERY SELECT v_invitation.wedding_id, v_attributed;
  END
  $$;
ALTER FUNCTION accept_access_invitation(text, uuid, smallint, partner_title, citext) OWNER TO kore_rls;
REVOKE ALL ON FUNCTION accept_access_invitation(text, uuid, smallint, partner_title, citext) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_access_invitation(text, uuid, smallint, partner_title, citext) TO kore_app;

-- Recusa (RN11; decisão 136): sem login, o link é a credencial; só convite
-- por e-mail, pendente e no prazo. Devolve se recusou.
CREATE FUNCTION decline_access_invitation(p_token_hash text) RETURNS boolean
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    UPDATE public.access_invitations SET declined_at = now()
    WHERE token_hash = p_token_hash AND email IS NOT NULL AND accepted_at IS NULL
      AND declined_at IS NULL AND revoked_at IS NULL AND superseded_at IS NULL
      AND expires_at > now()
    RETURNING true
  $$;
ALTER FUNCTION decline_access_invitation(text) OWNER TO kore_rls;
REVOKE ALL ON FUNCTION decline_access_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION decline_access_invitation(text) TO kore_app;
