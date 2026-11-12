-- Confirmar presença (RSVP RN07 e RN13) e a notificação da resposta (Central
-- RN02 a RN04; decisões 217(3) e (5)).

-- O contexto da transação do grupo passa a trazer o contato do casal, para o
-- GET do RSVP (RN03 e RN08: "WhatsApp do casal: {número}"). Mesma assinatura,
-- mesmo dono e mesmos grants.
CREATE OR REPLACE FUNCTION party_transaction_context(link_version integer) RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT jsonb_build_object(
      'status', w.status,
      'timezone', w.timezone,
      'eventDate', w.event_date,
      'rsvpDeadline', w.rsvp_deadline,
      'publishedAt', w.published_at,
      'songQuestionEnabled', w.song_question_enabled,
      'songQuestionText', w.song_question_text,
      'contactWhatsapp', w.contact_whatsapp,
      'contactEmail', w.contact_email
    )
    FROM public.parties p
    JOIN public.weddings w ON w.id = p.wedding_id
    WHERE p.id = public.current_party_id() AND p.wedding_id = public.current_wedding_id()
      AND p.deleted_at IS NULL
      AND p.link_version = party_transaction_context.link_version
      AND w.status IN ('published', 'post_event', 'grace')
  $$;

-- A notificação dos donos, criada ou somada na própria transação da resposta
-- (Central RN02 a RN04; decisão 217(3)): a única escrita fora do grupo na
-- transação do grupo. Recebe a gravação do grupo (só a do app.party_id, como
-- grupo) e os ids (UUID v7, gerados na API) das notificações novas.
--   - Uma linha por dono ativo (RN03), com groupKey rsvp:<weddingId>.
--   - Não lida do mesmo groupKey: soma (o grupo entra no payload ou tem a
--     entrada trocada pela nova, com o at novo), count = grupos distintos
--     (R7-2), e o updated_at vai para agora. Lida: abre outra (RN04).
--   - Sem restrição, música nem nome de convidado: só o grupo e os números.
-- Devolve se esta é a primeira gravação do grupo no casamento (o evento
-- primeira_resposta, decisão 217(5)) e quem foi avisado (os jobs de e-mail e
-- push). As gravações do casamento ficam em série pelo lock do wedding_stats,
-- então a conferência da primeira é exata.
GRANT SELECT ON "rsvp_submissions" TO kore_rls;
GRANT SELECT, INSERT, UPDATE ON "notifications" TO kore_rls;
CREATE FUNCTION notify_rsvp(submission uuid, notification_ids uuid[]) RETURNS jsonb
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

    WITH owners AS (
      SELECT m.user_id, row_number() OVER (ORDER BY m.user_id) AS n
      FROM public.memberships m
      WHERE m.wedding_id = s.wedding_id AND m.role = 'owner' AND m.removed_at IS NULL
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

    RETURN jsonb_build_object('firstResponse', is_first, 'recipients', to_jsonb(recipients));
  END
  $$;
ALTER FUNCTION notify_rsvp(uuid, uuid[]) OWNER TO kore_rls;
REVOKE ALL ON FUNCTION notify_rsvp(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notify_rsvp(uuid, uuid[]) TO kore_party;
