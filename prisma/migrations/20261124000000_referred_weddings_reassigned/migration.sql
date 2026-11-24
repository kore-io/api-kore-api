-- Link de indicação RN03 e RN04 (decisão 317(d)): a reatribuição pelo Admin
-- grava referral_source = 'admin_reassigned', e o novo indicador recebia a
-- comissão de um casal que não aparecia na lista dele. A lista passa a trazer
-- também o admin_reassigned do referrerId atual; o created_by_planner continua
-- fora. O antigo indicador já não é o referrer_id, então o casal sai da lista
-- dele. O resto da função é o mesmo da 20261114600000 (dono kore_rls e grants
-- mantidos pelo CREATE OR REPLACE).
CREATE OR REPLACE FUNCTION referred_weddings() RETURNS TABLE (
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
      AND w.referral_source IN ('referral_link', 'admin_reassigned')
      AND w.status <> 'purged'
    ORDER BY w.created_at DESC, w.id
  $$;
