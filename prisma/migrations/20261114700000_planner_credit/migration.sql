-- Assinatura do cerimonialista no site (Assinatura RN01 a RN06; decisões 223
-- e 224; revisão C7-1 e C7-2). Uma regra só, em quatro leituras: o site
-- público, a prévia, o convite do casal e o Editor.
--
-- As condições da RN02 ficam aqui. O predicado do nome (RN03) fica no
-- domínio, no isValidCreditName (planner-profile.ts), aplicado pelos leitores
-- num helper só (creditNameForSite): as classes de letra do Postgres
-- ([[:alpha:]] do glibc) não batem com as do Unicode (\p{L}), e o predicado em
-- dois lugares divergiria.

-- A cerimonialista do casamento (RN02): vínculo collaborator ativo de quem tem
-- Planner, com o Referrer planner ativo e a conta ativa. O vendedor (sem
-- Planner) não entra. Devolve o nome guardado (o predicado é do leitor), se o
-- Kore ocultou e a escolha do casal; sem colaboradora, nenhuma linha.
CREATE FUNCTION wedding_planner_collaborator(wedding uuid) RETURNS TABLE (
  credit_name text,
  hidden_by_kore boolean,
  show_planner_credit boolean
)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT p.credit_name,
           p.credit_hidden_at IS NOT NULL,
           w.show_planner_credit
    FROM public.memberships m
    JOIN public.weddings w ON w.id = m.wedding_id
    JOIN public.referrers r ON r.user_id = m.user_id AND r.kind = 'planner' AND r.status = 'active'
    JOIN public.planners p ON p.referrer_id = r.id
    JOIN public.users u ON u.id = m.user_id AND u.status = 'active'
    WHERE m.wedding_id = wedding_planner_collaborator.wedding
      AND m.role = 'collaborator' AND m.removed_at IS NULL
    LIMIT 1
  $$;
ALTER FUNCTION wedding_planner_collaborator(uuid) OWNER TO kore_rls;
REVOKE ALL ON FUNCTION wedding_planner_collaborator(uuid) FROM PUBLIC;

-- O nome que o site mostra (RN02), ou nulo: com a colaboradora, a escolha do
-- casal ligada e sem a ocultação do Kore. O leitor ainda aplica o predicado (RN03).
CREATE FUNCTION wedding_planner_credit(wedding uuid) RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT c.credit_name FROM public.wedding_planner_collaborator(wedding_planner_credit.wedding) c
    WHERE c.show_planner_credit AND NOT c.hidden_by_kore
  $$;
ALTER FUNCTION wedding_planner_credit(uuid) OWNER TO kore_rls;
REVOKE ALL ON FUNCTION wedding_planner_credit(uuid) FROM PUBLIC;
-- A prévia e o Editor chamam pela transação da requisição (kore_app); a
-- função não recebe nada além do casamento e só devolve o nome público.
GRANT EXECUTE ON FUNCTION wedding_planner_credit(uuid) TO kore_app;
GRANT EXECUTE ON FUNCTION wedding_planner_collaborator(uuid) TO kore_app;
GRANT SELECT ON "weddings", "memberships", "referrers", "planners", "users" TO kore_rls;

-- O site público (RN01): a assinatura entra na leitura do visitante e do grupo.
CREATE OR REPLACE FUNCTION site_public_by_slug(candidate citext) RETURNS jsonb
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
      ELSE jsonb_build_object('status', w.status)
    END
    FROM public.weddings w
    WHERE w.slug = candidate
  $$;
ALTER FUNCTION site_public_by_slug(citext) OWNER TO kore_rls;

-- O convite (Assinatura RN04): a prévia do aceite do casal mostra a assinatura.
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
