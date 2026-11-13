-- Dados para receber (card 75, PR 9a; Repasse e Dados para receber RN02 e RN03;
-- decisão 244). O kore_app não grava em referrers (colunas do CPF/CNPJ) nem em
-- referrer_pix_keys: tudo passa por estas funções SECURITY DEFINER, que acham o
-- indicador por current_referrer_id() e travam o Referrer antes de mexer nas
-- comissões, nas chaves e nos repasses (G3).

GRANT SELECT, UPDATE ("tax_id_type", "tax_id_encrypted", "tax_id_hash", "tax_id_hash_version",
                      "updated_at") ON "referrers" TO kore_rls;
GRANT SELECT, UPDATE ("status", "block_reason", "updated_at") ON "commissions" TO kore_rls;
GRANT SELECT, INSERT, UPDATE ON "referrer_pix_keys" TO kore_rls;
GRANT SELECT, UPDATE ("status", "hold_reason", "updated_at") ON "payouts" TO kore_rls;
GRANT INSERT ON "alerts" TO kore_rls;

-- RN02: o CPF ou CNPJ, uma vez só, único entre os indicadores; na mesma
-- transação, a autoindicação roda de novo nas comissões pending e available
-- (Comissões RN03), e o repasse pedido com uma delas fica retido (RN06 (e)).
-- Resultado: ok · locked · in_use · no_referrer.
CREATE FUNCTION set_referrer_tax_id(p_type tax_id_type, p_encrypted text, p_hash text,
                                    p_version smallint)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  #variable_conflict use_column
  DECLARE
    v_referrer uuid := public.current_referrer_id();
    v_current text;
  BEGIN
    IF v_referrer IS NULL THEN RETURN 'no_referrer'; END IF;
    SELECT tax_id_hash INTO v_current FROM public.referrers WHERE id = v_referrer FOR UPDATE;
    IF v_current IS NOT NULL THEN RETURN 'locked'; END IF;
    IF EXISTS (SELECT 1 FROM public.referrers WHERE tax_id_hash = p_hash) THEN
      RETURN 'in_use';
    END IF;
    BEGIN
      UPDATE public.referrers
      SET tax_id_type = p_type, tax_id_encrypted = p_encrypted, tax_id_hash = p_hash,
          tax_id_hash_version = p_version, updated_at = now()
      WHERE id = v_referrer;
    EXCEPTION WHEN unique_violation THEN
      RETURN 'in_use';
    END;
    WITH blocked AS (
      UPDATE public.commissions c
      SET status = 'blocked', block_reason = 'self_referral', updated_at = now()
      FROM public.payments p
      WHERE p.id = c.payment_id AND c.referrer_id = v_referrer
        AND c.status IN ('pending', 'available') AND p.payer_tax_id_hash = p_hash
      RETURNING c.payout_id)
    UPDATE public.payouts
    SET status = 'held', hold_reason = 'commission_blocked', updated_at = now()
    WHERE id IN (SELECT payout_id FROM blocked WHERE payout_id IS NOT NULL)
      AND status = 'requested';
    RETURN 'ok';
  END
  $$;

-- RN03: a troca confirmada passa a valer 48 h depois; aqui, as que venceram
-- viram a ativa (a antiga fica substituída) e o repasse retido pela troca
-- volta a solicitado. Chamada pelas outras funções (com o Referrer travado) e
-- pela rotina do worker, recortada por indicador ou não.
CREATE FUNCTION activate_due_referrer_pix_keys(p_now timestamptz, p_referrer uuid DEFAULT NULL)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  #variable_conflict use_column
  DECLARE
    v_key record;
    v_count integer := 0;
  BEGIN
    FOR v_key IN
      SELECT k.id, k.referrer_id FROM public.referrer_pix_keys k
      WHERE k.status = 'pending_activation' AND k.active_from <= p_now
        AND (p_referrer IS NULL OR k.referrer_id = p_referrer)
      ORDER BY k.referrer_id
    LOOP
      PERFORM 1 FROM public.referrers WHERE id = v_key.referrer_id FOR UPDATE;
      UPDATE public.referrer_pix_keys
      SET status = 'replaced', replaced_at = p_now, updated_at = now()
      WHERE referrer_id = v_key.referrer_id AND status = 'active';
      UPDATE public.referrer_pix_keys
      SET status = 'active', updated_at = now()
      WHERE id = v_key.id AND status = 'pending_activation';
      UPDATE public.payouts
      SET status = 'requested', hold_reason = NULL, updated_at = now()
      WHERE referrer_id = v_key.referrer_id AND status = 'held' AND hold_reason = 'pix_key_change';
      v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
  END
  $$;

-- RN03: cadastrar a primeira chave ou pedir a troca. A chave nasce esperando a
-- confirmação pelo e-mail (30 minutos); um pedido novo cancela o que ainda
-- esperava a confirmação. Com uma troca confirmada que ainda não vale:
-- change_pending (com a data). Resultado: ok · change_pending · no_referrer.
CREATE FUNCTION request_referrer_pix_key(p_id uuid, p_type pix_key_type, p_encrypted text,
                                         p_hash text, p_masked text, p_token_hash text,
                                         p_expires_at timestamptz, p_now timestamptz)
  RETURNS TABLE (result text, first_key boolean, active_from timestamptz)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  #variable_conflict use_column
  DECLARE
    v_referrer uuid := public.current_referrer_id();
    v_pending timestamptz;
  BEGIN
    IF v_referrer IS NULL THEN
      RETURN QUERY SELECT 'no_referrer'::text, false, NULL::timestamptz; RETURN;
    END IF;
    PERFORM 1 FROM public.referrers WHERE id = v_referrer FOR UPDATE;
    PERFORM public.activate_due_referrer_pix_keys(p_now, v_referrer);
    SELECT k.active_from INTO v_pending FROM public.referrer_pix_keys k
    WHERE k.referrer_id = v_referrer AND k.status = 'pending_activation';
    IF v_pending IS NOT NULL THEN
      RETURN QUERY SELECT 'change_pending'::text, false, v_pending; RETURN;
    END IF;
    UPDATE public.referrer_pix_keys
    SET status = 'canceled', canceled_at = p_now, confirm_token_hash = NULL, updated_at = now()
    WHERE referrer_id = v_referrer AND status = 'pending_confirmation';
    INSERT INTO public.referrer_pix_keys
      (id, created_at, updated_at, referrer_id, key_type, key_encrypted, key_hash, key_masked,
       status, confirm_token_hash, confirm_expires_at)
    VALUES (p_id, p_now, now(), v_referrer, p_type, p_encrypted, p_hash, p_masked,
            'pending_confirmation', p_token_hash, p_expires_at);
    RETURN QUERY SELECT 'ok'::text,
      NOT EXISTS (SELECT 1 FROM public.referrer_pix_keys
                  WHERE referrer_id = v_referrer AND status = 'active'),
      NULL::timestamptz;
  END
  $$;

-- RN03: a confirmação pelo link. A primeira chave vale na hora; a troca, 48 h
-- depois, e o repasse pedido fica retido até lá (RN06 (b)). A 3ª troca
-- confirmada em 24 h abre o alerta pix_key_churn (decisão 244(5)).
-- Resultado: active · pending_activation · expired · not_found · no_referrer.
CREATE FUNCTION confirm_referrer_pix_key(p_token_hash text, p_now timestamptz, p_alert_id uuid)
  RETURNS TABLE (result text, key_id uuid, active_from timestamptz, key_masked text)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  #variable_conflict use_column
  DECLARE
    v_referrer uuid := public.current_referrer_id();
    v_key record;
    v_first boolean;
    v_from timestamptz;
    v_changes integer;
  BEGIN
    IF v_referrer IS NULL THEN
      RETURN QUERY SELECT 'no_referrer'::text, NULL::uuid, NULL::timestamptz, NULL::text; RETURN;
    END IF;
    PERFORM 1 FROM public.referrers WHERE id = v_referrer FOR UPDATE;
    PERFORM public.activate_due_referrer_pix_keys(p_now, v_referrer);
    SELECT k.id, k.key_masked, k.confirm_expires_at INTO v_key FROM public.referrer_pix_keys k
    WHERE k.referrer_id = v_referrer AND k.status = 'pending_confirmation'
      AND k.confirm_token_hash = p_token_hash
    FOR UPDATE;
    IF v_key.id IS NULL THEN
      RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::timestamptz, NULL::text; RETURN;
    END IF;
    IF v_key.confirm_expires_at <= p_now THEN
      RETURN QUERY SELECT 'expired'::text, v_key.id, NULL::timestamptz, v_key.key_masked; RETURN;
    END IF;
    v_first := NOT EXISTS (SELECT 1 FROM public.referrer_pix_keys
                           WHERE referrer_id = v_referrer AND status = 'active');
    v_from := CASE WHEN v_first THEN p_now ELSE p_now + interval '48 hours' END;
    UPDATE public.referrer_pix_keys
    SET status = CASE WHEN v_first THEN 'active'::pix_key_status
                      ELSE 'pending_activation'::pix_key_status END,
        confirmed_at = p_now, active_from = v_from, confirm_token_hash = NULL,
        updated_at = now()
    WHERE id = v_key.id;
    IF NOT v_first THEN
      UPDATE public.payouts
      SET status = 'held', hold_reason = 'pix_key_change', updated_at = now()
      WHERE referrer_id = v_referrer AND status = 'requested';
      -- As trocas confirmadas (não a primeira chave, que vale na confirmação).
      SELECT count(*) INTO v_changes FROM public.referrer_pix_keys
      WHERE referrer_id = v_referrer AND confirmed_at > p_now - interval '24 hours'
        AND active_from > confirmed_at;
      IF v_changes >= 3 THEN
        INSERT INTO public.alerts (id, created_at, type, status, entity_type, entity_id, data)
        VALUES (p_alert_id, p_now, 'pix_key_churn', 'open', 'referrer', v_referrer::text,
                jsonb_build_object('changes', v_changes))
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
    RETURN QUERY SELECT CASE WHEN v_first THEN 'active' ELSE 'pending_activation' END,
      v_key.id, v_from, v_key.key_masked;
  END
  $$;

-- RN03: Cancelar troca enquanto ela não vale (ou o cadastro que esperava a
-- confirmação). O repasse retido pela troca volta a solicitado na hora.
-- Resultado: ok · not_found · no_referrer.
CREATE FUNCTION cancel_referrer_pix_key(p_id uuid, p_now timestamptz)
  RETURNS TABLE (result text, was_change boolean, key_masked text)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  #variable_conflict use_column
  DECLARE
    v_referrer uuid := public.current_referrer_id();
    v_key record;
  BEGIN
    IF v_referrer IS NULL THEN
      RETURN QUERY SELECT 'no_referrer'::text, false, NULL::text; RETURN;
    END IF;
    PERFORM 1 FROM public.referrers WHERE id = v_referrer FOR UPDATE;
    PERFORM public.activate_due_referrer_pix_keys(p_now, v_referrer);
    SELECT k.id, k.key_masked INTO v_key FROM public.referrer_pix_keys k
    WHERE k.id = p_id AND k.referrer_id = v_referrer
      AND k.status IN ('pending_confirmation', 'pending_activation')
    FOR UPDATE;
    IF v_key.id IS NULL THEN
      RETURN QUERY SELECT 'not_found'::text, false, NULL::text; RETURN;
    END IF;
    UPDATE public.referrer_pix_keys
    SET status = 'canceled', canceled_at = p_now, confirm_token_hash = NULL, updated_at = now()
    WHERE id = v_key.id;
    UPDATE public.payouts
    SET status = 'requested', hold_reason = NULL, updated_at = now()
    WHERE referrer_id = v_referrer AND status = 'held' AND hold_reason = 'pix_key_change';
    RETURN QUERY SELECT 'ok'::text,
      EXISTS (SELECT 1 FROM public.referrer_pix_keys
              WHERE referrer_id = v_referrer AND status = 'active'),
      v_key.key_masked;
  END
  $$;

-- O que o app lê ao montar a resposta (o cifrado fica fora do GRANT do kore_app).
CREATE FUNCTION my_referrer_payout_data()
  RETURNS TABLE (referrer_id uuid, tax_id_type tax_id_type, tax_id_encrypted text,
                 pix_key_masked text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT r.id, r.tax_id_type, r.tax_id_encrypted,
           (SELECT k.key_masked FROM public.referrer_pix_keys k
            WHERE k.referrer_id = r.id AND k.status = 'active')
    FROM public.referrers r WHERE r.id = public.current_referrer_id()
  $$;

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'set_referrer_tax_id(tax_id_type, text, text, smallint)',
    'activate_due_referrer_pix_keys(timestamptz, uuid)',
    'request_referrer_pix_key(uuid, pix_key_type, text, text, text, text, timestamptz, timestamptz)',
    'confirm_referrer_pix_key(text, timestamptz, uuid)',
    'cancel_referrer_pix_key(uuid, timestamptz)',
    'my_referrer_payout_data()'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO kore_rls', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
  END LOOP;
END
$$;
GRANT EXECUTE ON FUNCTION set_referrer_tax_id(tax_id_type, text, text, smallint) TO kore_app;
GRANT EXECUTE ON FUNCTION request_referrer_pix_key(uuid, pix_key_type, text, text, text, text,
                                                  timestamptz, timestamptz) TO kore_app;
GRANT EXECUTE ON FUNCTION confirm_referrer_pix_key(text, timestamptz, uuid) TO kore_app;
GRANT EXECUTE ON FUNCTION cancel_referrer_pix_key(uuid, timestamptz) TO kore_app;
GRANT EXECUTE ON FUNCTION my_referrer_payout_data() TO kore_app;
GRANT EXECUTE ON FUNCTION activate_due_referrer_pix_keys(timestamptz, uuid) TO kore_backoffice;

-- A leitura da própria chave já com as trocas que venceram (o GET da tela).
CREATE FUNCTION activate_my_due_pix_keys(p_now timestamptz)
  RETURNS integer
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT CASE WHEN public.current_referrer_id() IS NULL THEN 0
                ELSE public.activate_due_referrer_pix_keys(p_now, public.current_referrer_id()) END
  $$;
ALTER FUNCTION activate_my_due_pix_keys(timestamptz) OWNER TO kore_rls;
REVOKE ALL ON FUNCTION activate_my_due_pix_keys(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION activate_my_due_pix_keys(timestamptz) TO kore_app;
