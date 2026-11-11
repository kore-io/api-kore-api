-- Leitura pública do site do casal (Site público RN04, RN05 e RN09; decisão
-- 207, revisão técnica): o visitante não tem sessão nem vínculo, então a API
-- lê pelo endereço por uma função SECURITY DEFINER de kore_rls, nunca pela
-- conexão do backoffice.
--
-- O recorte do visitante é feito aqui: a função não devolve o contato do
-- casal nem os locais da Cerimônia & Recepção (só quantos são, para saber se
-- a seção tem conteúdo). O grupo identificado (link do convite) lê o resto por
-- outra função, que confere o grupo.
--
-- Rascunho e casamento fora do ar devolvem só o status: nenhum dado do casal
-- (RN04; decisão 205, D2).

GRANT SELECT ON "partners", "sections", "section_contents", "site_images" TO kore_rls;

CREATE FUNCTION site_public_by_slug(candidate citext) RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT CASE
      WHEN w.status IN ('published', 'post_event', 'grace') THEN jsonb_build_object(
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
      ELSE jsonb_build_object('status', w.status)
    END
    FROM public.weddings w
    WHERE w.slug = candidate
  $$;
ALTER FUNCTION site_public_by_slug(citext) OWNER TO kore_rls;
REVOKE ALL ON FUNCTION site_public_by_slug(citext) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION site_public_by_slug(citext) TO kore_app;
