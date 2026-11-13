-- Comissões do indicador (card 75, PR 8b): a leitura da própria pessoa
-- indicadora (RN07 e RN10), fora da RLS por casamento, como o Link de
-- indicação RN04: os nomes do casal (o casamento apagado sem nome), o tipo do
-- pagamento, os valores, o status e as datas, sem nenhum dado do pagador. A
-- linha abre o casamento só se ela também colabora nele.
CREATE FUNCTION referrer_commissions()
  RETURNS TABLE (id uuid, wedding_id uuid, wedding_purged boolean, partner1_name text,
                 partner2_name text, clickable boolean, payment_kind payment_kind,
                 base_amount_cents integer, amount_cents integer, rate_percent smallint,
                 status commission_status, available_at timestamptz, paid_at timestamptz,
                 created_at timestamptz, payout_id uuid)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT c.id, c.wedding_id, w.status = 'purged',
           CASE WHEN w.status = 'purged' THEN NULL ELSE split_part(btrim(p1.display_name), ' ', 1) END,
           CASE WHEN w.status = 'purged' THEN NULL ELSE split_part(btrim(p2.display_name), ' ', 1) END,
           w.status <> 'purged' AND EXISTS (
             SELECT 1 FROM public.memberships m
             WHERE m.wedding_id = w.id AND m.user_id = public.current_user_id()
               AND m.role = 'collaborator' AND m.removed_at IS NULL),
           p.kind, c.base_amount_cents, c.amount_cents, c.rate_percent, c.status,
           c.available_at, c.paid_at, c.created_at, c.payout_id
    FROM public.commissions c
    JOIN public.weddings w ON w.id = c.wedding_id
    JOIN public.payments p ON p.id = c.payment_id
    LEFT JOIN public.partners p1 ON p1.wedding_id = w.id AND p1.slot = 1
    LEFT JOIN public.partners p2 ON p2.wedding_id = w.id AND p2.slot = 2
    WHERE c.referrer_id = public.current_referrer_id()
    ORDER BY c.created_at DESC, c.id
  $$;
ALTER FUNCTION referrer_commissions() OWNER TO kore_rls;
REVOKE ALL ON FUNCTION referrer_commissions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION referrer_commissions() TO kore_app;
GRANT SELECT ON "commissions", "payments" TO kore_rls;
