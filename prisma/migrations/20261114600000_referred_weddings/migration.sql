-- Casais que vieram pelo link de indicação (Link de indicação RN03 a RN05;
-- decisão 224; revisão C5-1). É a única leitura de fato fora da RLS por
-- casamento: ela não é membro desses casamentos, e as policies de weddings e
-- partners negam a linha. Por isso, uma função SECURITY DEFINER do kore_rls,
-- no molde da site_public_by_slug, que:
--   - resolve o Referrer ativo por current_user_id(), sem receber id;
--   - filtra referral_source = 'referral_link' e tira a lápide;
--   - devolve só o id, o status, a data do cadastro, os primeiros nomes e se
--     ela tem vínculo collaborator ativo (a linha clicável, RN05).
-- Sem app.user_id, nada volta.
CREATE FUNCTION referred_weddings() RETURNS TABLE (
  wedding_id uuid,
  status wedding_status,
  created_at timestamptz,
  partner1_name text,
  partner2_name text,
  clickable boolean
)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT w.id, w.status, w.created_at,
           split_part(btrim(p1.display_name), ' ', 1),
           split_part(btrim(p2.display_name), ' ', 1),
           EXISTS (SELECT 1 FROM public.memberships m
                   WHERE m.wedding_id = w.id AND m.user_id = public.current_user_id()
                     AND m.role = 'collaborator' AND m.removed_at IS NULL)
    FROM public.weddings w
    LEFT JOIN public.partners p1 ON p1.wedding_id = w.id AND p1.slot = 1
    LEFT JOIN public.partners p2 ON p2.wedding_id = w.id AND p2.slot = 2
    WHERE w.referrer_id = public.current_referrer_id()
      AND w.referral_source = 'referral_link'
      AND w.status <> 'purged'
    ORDER BY w.created_at DESC, w.id
  $$;
ALTER FUNCTION referred_weddings() OWNER TO kore_rls;
REVOKE ALL ON FUNCTION referred_weddings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION referred_weddings() TO kore_app;
