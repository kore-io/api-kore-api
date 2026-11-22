-- Decisão 282(2): no casamento bloqueado, o e-mail da recusa do convite de
-- acesso não sai (Casamento bloqueado RN06). O convite passa a dizer se o
-- casamento está bloqueado. O resto da função fica igual à
-- 20261114700000_planner_credit (o retorno é jsonb: CREATE OR REPLACE basta).
CREATE OR REPLACE FUNCTION access_invitation_by_token(p_token_hash text) RETURNS jsonb
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
        -- Casamento bloqueado RN06 (decisão 282(2)): sem o e-mail da recusa.
        'blocked', w.blocked_at IS NOT NULL,
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
      'referralDiscountPercent', (SELECT s.referral_discount_percent FROM public.referral_settings s),
      -- A prévia do aceite mostra a assinatura (Assinatura RN04), pela mesma regra.
      'plannerCredit', public.wedding_planner_credit(w.id)
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
