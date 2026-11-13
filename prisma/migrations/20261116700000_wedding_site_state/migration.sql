-- A função única do "site no ar" (Data de saída do ar RN08; revisão técnica G4
-- e B4-4): todo caminho público (o site, o link do grupo, a prévia do link e a
-- transação do grupo, que serve ao RSVP) pergunta a ela, e nenhum fica aberto
-- num site bloqueado, expirado ou com exclusão agendada. As funções abaixo são
-- as definições em vigor (de site_public, site_party, party_transaction, rsvp,
-- f4_f5_model e planner_credit), com o predicado de status trocado por ela.

-- Nesta ordem: not_found (rascunho, aguardando o casal, apagado ou inexistente);
-- unavailable (bloqueado); expired (expirado ou exclusão agendada); live
-- (publicado, pós-evento ou carência). Na carência o site funciona (D21).
CREATE FUNCTION wedding_site_state(wedding uuid) RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT CASE
      WHEN w.id IS NULL OR w.status IN ('draft', 'awaiting_couple', 'purged') THEN 'not_found'
      WHEN w.blocked_at IS NOT NULL THEN 'unavailable'
      WHEN w.status = 'expired' OR w.deletion_scheduled_for IS NOT NULL THEN 'expired'
      WHEN w.status IN ('published', 'post_event', 'grace') THEN 'live'
      ELSE 'not_found'
    END
    FROM (SELECT wedding_site_state.wedding AS id) target
    LEFT JOIN public.weddings w ON w.id = target.id
  $$;
ALTER FUNCTION wedding_site_state(uuid) OWNER TO kore_rls;
REVOKE ALL ON FUNCTION wedding_site_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wedding_site_state(uuid) TO kore_app, kore_party, kore_backoffice;

-- O site pelo endereço: fora do ar, só o status e o estado (o app responde 404,
-- 410 ou 423).
CREATE OR REPLACE FUNCTION public.site_public_by_slug(candidate citext)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT CASE
      WHEN public.wedding_site_state(w.id) = 'live' THEN jsonb_build_object(
        'status', w.status,
        'weddingId', w.id,
        'slug', w.slug,
        'eventDate', w.event_date,
        'city', w.city,
        'state', w.state,
        'timezone', w.timezone,
        'fontPairKey', w.font_pair_key,
        'primaryColor', w.primary_color,
        'accentColor', w.accent_color,
        'backgroundMode', w.background_mode,
        'coverImageId', w.cover_image_id,
        -- Assinatura da assessoria (Assinatura RN01 e RN02): a mesma regra das
        -- quatro leituras, na wedding_planner_credit.
        'plannerCredit', public.wedding_planner_credit(w.id),
        'partners', (
          SELECT coalesce(jsonb_agg(p.display_name ORDER BY p.slot), '[]'::jsonb)
          FROM public.partners p WHERE p.wedding_id = w.id
        ),
        -- Só as seções ligadas da F2, na ordem fixa, com o conteúdo pt-BR. Da
        -- Cerimônia & Recepção, só a quantidade de locais.
        'sections', (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'type', s.type,
            'title', s.title,
            'content', CASE
              WHEN s.type = 'ceremony'
                THEN jsonb_build_object('venueCount', jsonb_array_length(coalesce(c.content -> 'venues', '[]'::jsonb)))
              ELSE c.content
            END
          ) ORDER BY s.position), '[]'::jsonb)
          FROM public.sections s
          JOIN public.section_contents c ON c.section_id = s.id AND c.locale = 'pt-BR'
          WHERE s.wedding_id = w.id AND s.enabled
            AND s.type IN ('story', 'countdown', 'ceremony', 'lodging', 'dress_code', 'faq')
        ),
        -- As imagens prontas do casamento (até 40): o site resolve os ids da
        -- capa e das seções e ignora o que não estiver aqui.
        'images', (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', i.id,
            'storageKey', i.storage_key,
            'thumbKey', i.thumb_key,
            'ogKey', i.og_key,
            'width', i.width,
            'height', i.height
          )), '[]'::jsonb)
          FROM public.site_images i WHERE i.wedding_id = w.id AND i.status = 'ready'
        )
      )
      -- Fora do ar: só o status e o estado, sem dado do casal (RN08).
      ELSE jsonb_build_object('status', w.status, 'siteState', public.wedding_site_state(w.id))
    END
    FROM public.weddings w
    WHERE w.slug = candidate
  $function$;

-- O link do grupo: o estado, para a mesma página do site (RN08).
CREATE OR REPLACE FUNCTION public.site_party_by_token(token text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT jsonb_build_object(
      'weddingId', w.id,
      'slug', w.slug,
      'status', w.status,
      'siteState', public.wedding_site_state(w.id),
      'partyId', p.id,
      'partyName', p.name,
      'linkVersion', p.link_version
    )
    FROM public.parties p
    JOIN public.weddings w ON w.id = p.wedding_id
    WHERE p.link_token = token AND p.deleted_at IS NULL
  $function$;

-- O que o link do grupo mostra: só com o site no ar.
CREATE OR REPLACE FUNCTION public.site_party_view(wedding uuid, party uuid, version integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT jsonb_build_object(
      'partyName', p.name,
      'contactWhatsapp', w.contact_whatsapp,
      'contactEmail', w.contact_email,
      'venues', (
        SELECT coalesce(c.content -> 'venues', '[]'::jsonb)
        FROM public.sections s
        JOIN public.section_contents c ON c.section_id = s.id AND c.locale = 'pt-BR'
        WHERE s.wedding_id = w.id AND s.type = 'ceremony'
      )
    )
    FROM public.parties p
    JOIN public.weddings w ON w.id = p.wedding_id
    WHERE p.id = site_party_view.party AND p.wedding_id = site_party_view.wedding
      AND p.deleted_at IS NULL
      AND p.link_version = site_party_view.version
      AND public.wedding_site_state(w.id) = 'live'
  $function$;

-- O contexto da transação do grupo (o RSVP): fora do ar, só o estado; o app
-- recusa e nada é gravado (RN07 e RN08).
CREATE OR REPLACE FUNCTION public.party_transaction_context(link_version integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT CASE WHEN public.wedding_site_state(w.id) <> 'live'
      THEN jsonb_build_object('siteState', public.wedding_site_state(w.id))
      ELSE jsonb_build_object(
      'siteState', 'live',
      'status', w.status,
      'timezone', w.timezone,
      'eventDate', w.event_date,
      'rsvpDeadline', w.rsvp_deadline,
      'publishedAt', w.published_at,
      'songQuestionEnabled', w.song_question_enabled,
      'songQuestionText', w.song_question_text,
      'contactWhatsapp', w.contact_whatsapp,
      'contactEmail', w.contact_email
    ) END
    FROM public.parties p
    JOIN public.weddings w ON w.id = p.wedding_id
    WHERE p.id = public.current_party_id() AND p.wedding_id = public.current_wedding_id()
      AND p.deleted_at IS NULL
      AND p.link_version = party_transaction_context.link_version
  $function$;
