-- Decisão 275: as ações do log de Comissões (commission.created, .available,
-- .reversed, .held e .blocked) e de Repasse (payout.held, .paid e .failed),
-- como pedem as Mudanças no modelo de dados das duas specs. A comissão e o
-- repasse mudam de status em vários lugares (o ledger do backoffice, as
-- funções do reembolso, a correção do CPF, o trigger do repasse, as rotinas),
-- então o log é gravado por trigger, na mesma transação, com ator `system`.
-- Ficam com o log da aplicação (e o ator Admin) as ações que o Admin faz e
-- que já são gravadas: o bloqueio manual da comissão (block_reason `admin`) e
-- o desbloqueio dela, o Liberar, o Recusar e o Pagar.

-- UUID v7 no banco (o mesmo formato do uuidV7 da aplicação): 48 bits do
-- relógio em ms e o resto aleatório, com a versão 7 e a variante RFC 4122.
CREATE FUNCTION log_uuid_v7() RETURNS uuid
  LANGUAGE sql
  VOLATILE
  SET search_path = public, pg_temp
  AS $$
    SELECT encode(
      set_bit(set_bit(
        overlay(uuid_send(gen_random_uuid())
                PLACING substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
                FROM 1 FOR 6),
        52, 1), 53, 1),
      'hex')::uuid
  $$;
ALTER FUNCTION log_uuid_v7() OWNER TO kore_rls;
REVOKE ALL ON FUNCTION log_uuid_v7() FROM PUBLIC;

GRANT INSERT ON "application_logs" TO kore_rls;

CREATE FUNCTION log_commission_change() RETURNS trigger
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
                'blockReason', NEW.block_reason::text));
    END LOOP;
    RETURN NULL;
  END
  $$;
ALTER FUNCTION log_commission_change() OWNER TO kore_rls;
REVOKE ALL ON FUNCTION log_commission_change() FROM PUBLIC;
CREATE TRIGGER trg_commissions_log_insert
  AFTER INSERT ON "commissions"
  FOR EACH ROW
  EXECUTE FUNCTION log_commission_change();
CREATE TRIGGER trg_commissions_log_update
  AFTER UPDATE OF status ON "commissions"
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION log_commission_change();

-- payout.held: qualquer retenção (a comissão, a troca da chave, o indicador
-- ou a comissão bloqueados); payout.paid: o Pix de saída confirmado;
-- payout.failed: a falha definitiva, que devolve o repasse de processing a
-- requested (RN05).
CREATE FUNCTION log_payout_change() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_action text;
  BEGIN
    IF NEW.status = 'held' THEN
      v_action := 'payout.held';
    ELSIF NEW.status = 'paid' THEN
      v_action := 'payout.paid';
    ELSIF OLD.status = 'processing' AND NEW.status = 'requested' THEN
      v_action := 'payout.failed';
    ELSE
      RETURN NULL;
    END IF;
    INSERT INTO public.application_logs
      (id, created_at, actor_kind, action, entity_type, entity_id, data)
    VALUES (public.log_uuid_v7(), clock_timestamp(), 'system', v_action, 'payout', NEW.id::text,
            jsonb_build_object(
              'referrerId', NEW.referrer_id,
              'amountCents', NEW.amount_cents,
              'previousStatus', OLD.status::text,
              'holdReason', NEW.hold_reason::text,
              'gatewayTransferId', CASE WHEN v_action = 'payout.paid' THEN NEW.gateway_transfer_id END,
              'error', CASE WHEN v_action = 'payout.failed' THEN NEW.last_error END));
    RETURN NULL;
  END
  $$;
ALTER FUNCTION log_payout_change() OWNER TO kore_rls;
REVOKE ALL ON FUNCTION log_payout_change() FROM PUBLIC;
CREATE TRIGGER trg_payouts_log
  AFTER UPDATE OF status ON "payouts"
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION log_payout_change();
