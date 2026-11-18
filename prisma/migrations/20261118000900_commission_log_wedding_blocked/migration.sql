-- Decisão 282(3): o log commission.blocked do bloqueio pelo casamento (pelo trigger da
-- 20261118000400, com ator system) leva também o adminUserId de quem bloqueou
-- o casamento. O resto da função fica igual (dono e grants mantidos).
CREATE OR REPLACE FUNCTION log_commission_change() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_actions text[] := ARRAY[]::text[];
    v_action text;
  BEGIN
    IF TG_OP = 'INSERT' THEN
      v_actions := ARRAY['commission.created'];
      -- O bloqueio de nascença (autoindicação, indicador bloqueado).
      IF NEW.status = 'blocked' THEN v_actions := array_append(v_actions, 'commission.blocked'); END IF;
    ELSIF NEW.status = 'available' AND OLD.status IS DISTINCT FROM 'blocked' THEN
      v_actions := ARRAY['commission.available'];
    ELSIF NEW.status = 'reversed' THEN
      v_actions := ARRAY['commission.reversed'];
    ELSIF NEW.status = 'held' THEN
      v_actions := ARRAY['commission.held'];
    ELSIF NEW.status = 'blocked' AND NEW.block_reason IS DISTINCT FROM 'admin' THEN
      v_actions := ARRAY['commission.blocked'];
    END IF;
    FOREACH v_action IN ARRAY v_actions LOOP
      INSERT INTO public.application_logs
        (id, created_at, wedding_id, actor_kind, action, entity_type, entity_id, data)
      VALUES (public.log_uuid_v7(), clock_timestamp(), NEW.wedding_id, 'system', v_action,
              'commission', NEW.id::text,
              jsonb_build_object(
                'referrerId', NEW.referrer_id,
                'paymentId', NEW.payment_id,
                'payoutId', NEW.payout_id,
                'amountCents', NEW.amount_cents,
                'previousStatus', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status::text END,
                'status', NEW.status::text,
                'blockReason', NEW.block_reason::text)
              -- Decisão 282(3): no bloqueio pelo casamento, quem bloqueou o casamento.
              || CASE WHEN NEW.block_reason::text = 'wedding_blocked'
                   THEN jsonb_build_object('adminUserId',
                          (SELECT w.blocked_by_user_id FROM public.weddings w WHERE w.id = NEW.wedding_id))
                   ELSE '{}'::jsonb END);
    END LOOP;
    RETURN NULL;
  END
  $$;
ALTER FUNCTION log_commission_change() OWNER TO kore_rls;
REVOKE ALL ON FUNCTION log_commission_change() FROM PUBLIC;
