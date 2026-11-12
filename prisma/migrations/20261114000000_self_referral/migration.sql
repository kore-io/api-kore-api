-- Decisão 224(2), autoindicação: no convite do casal (link ou e-mail), quem
-- aceita não pode ser o indicador a que o casamento está atribuído. O caso de
-- uso já recusa antes (409 SELF_REFERRAL); a barreira fica também aqui, sob o
-- lock do casamento, para nenhum caminho gravar o aceite sem ela.
--   KA005  quem aceita é o indicador do casamento (convite couple)
-- Mesma assinatura: o CREATE OR REPLACE mantém o dono (kore_rls) e os GRANTs.

CREATE OR REPLACE FUNCTION accept_access_invitation(
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
      RAISE EXCEPTION 'accept_access_invitation: invitation not pending' USING ERRCODE = 'KA001';
    END IF;
    PERFORM 1 FROM public.weddings WHERE id = v_invitation.wedding_id FOR UPDATE;

    IF v_invitation.kind = 'couple' AND EXISTS (
         SELECT 1 FROM public.weddings w JOIN public.referrers r ON r.id = w.referrer_id
         WHERE w.id = v_invitation.wedding_id AND r.user_id = v_user) THEN
      RAISE EXCEPTION 'accept_access_invitation: self referral' USING ERRCODE = 'KA005';
    END IF;

    IF v_invitation.role = 'owner' THEN
      IF (SELECT count(*) FROM public.memberships m WHERE m.wedding_id = v_invitation.wedding_id
            AND m.role = 'owner' AND m.removed_at IS NULL) >= 2 THEN
        RAISE EXCEPTION 'accept_access_invitation: owners full' USING ERRCODE = 'KA002';
      END IF;
      UPDATE public.partners SET user_id = v_user, title = coalesce(p_partner_title, title)
        WHERE partners.wedding_id = v_invitation.wedding_id AND slot = p_partner_slot
          AND user_id IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'accept_access_invitation: partner taken' USING ERRCODE = 'KA003';
      END IF;
    ELSIF EXISTS (SELECT 1 FROM public.memberships m WHERE m.wedding_id = v_invitation.wedding_id
                    AND m.role = 'collaborator' AND m.removed_at IS NULL) THEN
      RAISE EXCEPTION 'accept_access_invitation: planner already' USING ERRCODE = 'KA004';
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
