-- Notificações da cerimonialista (RN01 a RN06 e RN10; decisões 223 e 224;
-- revisão C8-1 a C8-5).

-- Os casamentos que ela indicou (o Referrer ativo da pessoa), sem id por
-- parâmetro, para a policy do wedding_published (RN10).
CREATE FUNCTION referred_wedding_ids() RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT w.id FROM public.weddings w WHERE w.referrer_id = public.current_referrer_id()
  $$;
ALTER FUNCTION referred_wedding_ids() OWNER TO kore_rls;
REVOKE ALL ON FUNCTION referred_wedding_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION referred_wedding_ids() TO kore_app;

-- Policies por tipo (RN10; decisão 224, bloqueante 3). O rsvp segue só com
-- vínculo ativo (quem saiu deixa de ver as antigas, D18); o wedding_published,
-- com vínculo ou indicado por ela; o membership_removed é o aviso da saída e
-- vale sempre.
DROP POLICY "notifications_own_select" ON "notifications";
DROP POLICY "notifications_own_update" ON "notifications";
CREATE POLICY "notifications_own_select" ON "notifications" FOR SELECT
  USING ("user_id" = current_user_id()
         AND (current_wedding_id() IS NULL OR "wedding_id" = current_wedding_id())
         AND (("type" = 'rsvp' AND "wedding_id" IN (SELECT active_wedding_ids()))
              OR ("type" = 'wedding_published'
                  AND ("wedding_id" IN (SELECT active_wedding_ids())
                       OR "wedding_id" IN (SELECT referred_wedding_ids())))
              OR "type" = 'membership_removed'));
CREATE POLICY "notifications_own_update" ON "notifications" FOR UPDATE
  USING ("user_id" = current_user_id()
         AND (current_wedding_id() IS NULL OR "wedding_id" = current_wedding_id())
         AND (("type" = 'rsvp' AND "wedding_id" IN (SELECT active_wedding_ids()))
              OR ("type" = 'wedding_published'
                  AND ("wedding_id" IN (SELECT active_wedding_ids())
                       OR "wedding_id" IN (SELECT referred_wedding_ids())))
              OR "type" = 'membership_removed'))
  WITH CHECK ("user_id" = current_user_id());

-- Os primeiros nomes do casal, para o payload dos tipos novos (revisão C8-3).
CREATE FUNCTION wedding_partner_names(wedding uuid) RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT coalesce(jsonb_agg(split_part(btrim(p.display_name), ' ', 1) ORDER BY p.slot), '[]'::jsonb)
    FROM public.partners p WHERE p.wedding_id = wedding_partner_names.wedding
  $$;
ALTER FUNCTION wedding_partner_names(uuid) OWNER TO kore_rls;
REVOKE ALL ON FUNCTION wedding_partner_names(uuid) FROM PUBLIC;

-- RN03: na primeira publicação (quem chama confere que o publishedAt era
-- nulo), na mesma transação. Para quem indicou (Referrer planner ativo) e para
-- a cerimonialista colaboradora com Planner; a mesma pessoa, uma linha só. O
-- índice único do tipo é a segunda barreira. Só no casamento da transação,
-- já publicado.
CREATE FUNCTION notify_wedding_published(notification_ids uuid[]) RETURNS uuid[]
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    wedding uuid := public.current_wedding_id();
    recipients uuid[];
  BEGIN
    IF wedding IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.weddings w WHERE w.id = wedding AND w.published_at IS NOT NULL)
       OR wedding NOT IN (SELECT public.owned_wedding_ids()) THEN
      RAISE EXCEPTION 'notify_wedding_published: fora do casamento publicado da transação';
    END IF;
    WITH people AS (
      SELECT r.user_id FROM public.weddings w
      JOIN public.referrers r ON r.id = w.referrer_id AND r.kind = 'planner' AND r.status = 'active'
      WHERE w.id = wedding
      UNION
      SELECT m.user_id FROM public.memberships m
      JOIN public.referrers r ON r.user_id = m.user_id AND r.kind = 'planner' AND r.status = 'active'
      JOIN public.planners p ON p.referrer_id = r.id
      WHERE m.wedding_id = wedding AND m.role = 'collaborator' AND m.removed_at IS NULL
    ), numbered AS (
      SELECT user_id, row_number() OVER (ORDER BY user_id) AS n FROM people
    ), written AS (
      INSERT INTO public.notifications (id, user_id, wedding_id, type, group_key, count, payload)
      SELECT notify_wedding_published.notification_ids[n], user_id, wedding, 'wedding_published',
             'wedding_published:' || wedding, 1,
             jsonb_build_array(jsonb_build_object('partnerNames', public.wedding_partner_names(wedding)))
      FROM numbered
      ON CONFLICT DO NOTHING
      RETURNING user_id
    )
    SELECT coalesce(array_agg(user_id), '{}') INTO recipients FROM written;
    RETURN recipients;
  END
  $$;
ALTER FUNCTION notify_wedding_published(uuid[]) OWNER TO kore_rls;
REVOKE ALL ON FUNCTION notify_wedding_published(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notify_wedding_published(uuid[]) TO kore_app;

-- RN04: quando o dono remove a cerimonialista (com Planner), na mesma
-- transação da remoção. Quando ela sai por conta própria, nada. O groupKey
-- leva o id do vínculo: remover, convidar de novo e remover outra vez não bate
-- no índice das não lidas.
CREATE FUNCTION notify_membership_removed(membership uuid, notification_id uuid) RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    m public.memberships%ROWTYPE;
  BEGIN
    SELECT * INTO m FROM public.memberships
    WHERE id = notify_membership_removed.membership
      AND wedding_id = public.current_wedding_id()
      AND role = 'collaborator' AND removed_at IS NOT NULL
      AND removed_by_user_id = public.current_user_id()
      AND user_id <> public.current_user_id();
    IF NOT FOUND OR m.wedding_id NOT IN (SELECT public.owned_wedding_ids()) THEN
      RAISE EXCEPTION 'notify_membership_removed: fora da remoção feita pelo dono';
    END IF;
    IF NOT EXISTS (
         SELECT 1 FROM public.referrers r JOIN public.planners p ON p.referrer_id = r.id
         WHERE r.user_id = m.user_id AND r.kind = 'planner') THEN
      RETURN false;
    END IF;
    INSERT INTO public.notifications (id, user_id, wedding_id, type, group_key, count, payload)
    VALUES (notify_membership_removed.notification_id, m.user_id, m.wedding_id, 'membership_removed',
            'membership_removed:' || m.id, 1,
            jsonb_build_array(jsonb_build_object('partnerNames', public.wedding_partner_names(m.wedding_id))));
    RETURN true;
  END
  $$;
ALTER FUNCTION notify_membership_removed(uuid, uuid) OWNER TO kore_rls;
REVOKE ALL ON FUNCTION notify_membership_removed(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notify_membership_removed(uuid, uuid) TO kore_app;
GRANT SELECT ON "partners", "weddings", "memberships", "referrers", "planners" TO kore_rls;

-- RN02: a notify_rsvp inclui a cerimonialista colaboradora com Planner.
CREATE OR REPLACE FUNCTION notify_rsvp(submission uuid, notification_ids uuid[]) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    s public.rsvp_submissions%ROWTYPE;
    party_name text;
    entry jsonb;
    is_first boolean;
    recipients uuid[];
  BEGIN
    SELECT * INTO s FROM public.rsvp_submissions
    WHERE id = notify_rsvp.submission
      AND party_id = public.current_party_id()
      AND wedding_id = public.current_wedding_id()
      AND actor = 'party';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'notify_rsvp: gravação fora do grupo da transação';
    END IF;
    SELECT name INTO party_name FROM public.parties WHERE id = s.party_id;
    entry := jsonb_build_object(
      'partyId', s.party_id,
      'name', party_name,
      'confirmed', s.confirmed_count,
      'declined', s.declined_count,
      'at', to_char(s.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    is_first := NOT EXISTS (
      SELECT 1 FROM public.rsvp_submissions o
      WHERE o.wedding_id = s.wedding_id AND o.actor = 'party' AND o.id <> s.id);

    -- Os donos e a cerimonialista colaboradora com Planner (Notificações da
    -- cerimonialista RN02); o vendedor, colaborador sem Planner, não recebe.
    WITH owners AS (
      SELECT m.user_id, row_number() OVER (ORDER BY m.role DESC, m.user_id) AS n
      FROM public.memberships m
      WHERE m.wedding_id = s.wedding_id AND m.removed_at IS NULL
        AND (m.role = 'owner'
             OR (m.role = 'collaborator' AND EXISTS (
                   SELECT 1 FROM public.referrers r JOIN public.planners p ON p.referrer_id = r.id
                   WHERE r.user_id = m.user_id AND r.kind = 'planner' AND r.status = 'active')))
    ), written AS (
      INSERT INTO public.notifications AS n
        (id, user_id, wedding_id, type, group_key, count, payload, created_at, updated_at)
      SELECT notify_rsvp.notification_ids[o.n], o.user_id, s.wedding_id, 'rsvp',
             'rsvp:' || s.wedding_id, 1, jsonb_build_array(entry), s.created_at, s.created_at
      FROM owners o
      ON CONFLICT (user_id, group_key) WHERE read_at IS NULL DO UPDATE
        SET payload = (
              SELECT coalesce(jsonb_agg(e ORDER BY ordinality), '[]'::jsonb)
              FROM jsonb_array_elements(n.payload) WITH ORDINALITY AS t(e, ordinality)
              WHERE e->>'partyId' <> entry->>'partyId'
            ) || jsonb_build_array(entry),
            count = (
              SELECT count(*) + 1 FROM jsonb_array_elements(n.payload) AS t(e)
              WHERE e->>'partyId' <> entry->>'partyId'
            ),
            updated_at = excluded.updated_at
      RETURNING n.user_id
    )
    SELECT coalesce(array_agg(user_id), '{}') INTO recipients FROM written;

    -- recipients segue com os donos (os jobs de e-mail e push do casal); a
    -- cerimonialista vem à parte, para o envio pela preferência geral (RN06).
    RETURN jsonb_build_object(
      'firstResponse', is_first,
      'recipients', to_jsonb(ARRAY(
        SELECT u FROM unnest(recipients) AS u
        WHERE EXISTS (SELECT 1 FROM public.memberships m
                      WHERE m.wedding_id = s.wedding_id AND m.user_id = u
                        AND m.role = 'owner' AND m.removed_at IS NULL))),
      'plannerRecipients', to_jsonb(ARRAY(
        SELECT u FROM unnest(recipients) AS u
        WHERE NOT EXISTS (SELECT 1 FROM public.memberships m
                          WHERE m.wedding_id = s.wedding_id AND m.user_id = u
                            AND m.role = 'owner' AND m.removed_at IS NULL))));
  END
  $$;
ALTER FUNCTION notify_rsvp(uuid, uuid[]) OWNER TO kore_rls;
