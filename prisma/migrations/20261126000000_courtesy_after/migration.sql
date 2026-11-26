-- Pagamentos e arrependimento RN03 (decisão 345(1)): o refundableUntil do
-- GET …/billing segue o recorte do Desistir, e a extensão com cortesia do Admin
-- concedida depois não é desistível. O kore_app não lê courtesy_extensions
-- (o motivo e o Admin ficam de fora): esta função só diz se há cortesia a
-- partir de uma data, e só para um casamento de que a pessoa é dona (os
-- pagamentos, pela RLS, também só aparecem para o dono).
CREATE FUNCTION wedding_courtesy_from(wedding uuid, from_date date) RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT wedding_courtesy_from.wedding IN (SELECT public.owned_wedding_ids())
      AND EXISTS (
        SELECT 1 FROM public.courtesy_extensions c
        WHERE c.wedding_id = wedding_courtesy_from.wedding
          AND c.period_start >= wedding_courtesy_from.from_date)
  $$;
ALTER FUNCTION wedding_courtesy_from(uuid, date) OWNER TO kore_rls;
REVOKE ALL ON FUNCTION wedding_courtesy_from(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wedding_courtesy_from(uuid, date) TO kore_app;
