-- Decisão 275 (achado do Gazua, mesma classe da 272): a wedding_partner_names
-- é SECURITY DEFINER e o kore_support tem EXECUTE nela; pelo papel, um
-- SELECT wedding_partner_names('<outro casamento>') devolvia os primeiros
-- nomes de outro casal. No papel do suporte, a função só responde pelo
-- casamento da sessão (app.wedding_id); fora dele, a lista vazia, como a RLS
-- faria. O GUC role é o do SET LOCAL ROLE e não muda dentro da função
-- SECURITY DEFINER (que só troca o current_user). Os outros papéis seguem
-- como antes (a notify_wedding_published a chama como kore_rls).
CREATE OR REPLACE FUNCTION wedding_partner_names(wedding uuid) RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT coalesce(jsonb_agg(split_part(btrim(p.display_name), ' ', 1) ORDER BY p.slot), '[]'::jsonb)
    FROM public.partners p
    WHERE p.wedding_id = wedding_partner_names.wedding
      AND (current_setting('role', true) IS DISTINCT FROM 'kore_support'
           OR p.wedding_id = public.current_wedding_id())
  $$;
