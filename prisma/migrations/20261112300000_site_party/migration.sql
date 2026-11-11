-- Link do grupo no site do casal (Site público RN05 e RN06; ADR-36; decisão
-- 207, revisão técnica): o convidado não tem sessão nem vínculo, então a API
-- resolve o grupo e lê o que é só dele por funções SECURITY DEFINER de
-- kore_rls, nunca pela conexão do backoffice.

-- O token do link (Party.linkToken) resolve o grupo e o casamento. Grupo na
-- lixeira não resolve: o link deixa de funcionar (RN06).
CREATE FUNCTION site_party_by_token(token text) RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT jsonb_build_object(
      'weddingId', w.id,
      'slug', w.slug,
      'status', w.status,
      'partyId', p.id,
      'partyName', p.name,
      'linkVersion', p.link_version
    )
    FROM public.parties p
    JOIN public.weddings w ON w.id = p.wedding_id
    WHERE p.link_token = token AND p.deleted_at IS NULL
  $$;
ALTER FUNCTION site_party_by_token(text) OWNER TO kore_rls;
REVOKE ALL ON FUNCTION site_party_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION site_party_by_token(text) TO kore_app;

-- O que só o grupo identificado vê (RN05): o nome do grupo, o contato do casal
-- e os locais da Cerimônia & Recepção. A cada leitura, confere o grupo do
-- cookie: do casamento, fora da lixeira e com a mesma versão do link (ADR-36,
-- item 2), e o casamento no ar. Senão, nulo, e o site responde como visitante.
CREATE FUNCTION site_party_view(wedding uuid, party uuid, version integer) RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
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
    WHERE p.id = party AND p.wedding_id = wedding AND p.deleted_at IS NULL
      AND p.link_version = version
      AND w.status IN ('published', 'post_event', 'grace')
  $$;
GRANT SELECT ON "parties" TO kore_rls;
ALTER FUNCTION site_party_view(uuid, uuid, integer) OWNER TO kore_rls;
REVOKE ALL ON FUNCTION site_party_view(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION site_party_view(uuid, uuid, integer) TO kore_app;
