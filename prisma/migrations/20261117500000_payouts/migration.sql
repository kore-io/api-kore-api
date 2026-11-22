-- O pedido de repasse (card 75, PR 9b; Repasse e Dados para receber RN04 e
-- RN06; decisão 247). O kore_app só lê os repasses (por current_referrer_id());
-- o pedido grava pela função SECURITY DEFINER abaixo (G3), e as retenções
-- seguem a comissão por um trigger, qualquer que seja quem a mude (a função
-- do reembolso, o ledger do backoffice, a correção do CPF).

GRANT SELECT, INSERT ON "payouts" TO kore_rls;
GRANT UPDATE ("payout_id", "updated_at") ON "commissions" TO kore_rls;
GRANT SELECT ("id", "payout_id", "amount_cents", "status", "available_at", "payment_id",
              "referrer_id")
  ON "commissions" TO kore_rls;
GRANT SELECT, UPDATE ("payout_id") ON "commission_adjustments" TO kore_rls;
GRANT SELECT ON "referral_settings" TO kore_rls;

-- RN06 e decisão 247(3): a comissão de um repasse pedido muda, e o repasse
-- acompanha. Retida (o pedido de reembolso ou a contestação): o repasse fica
-- retido por refund ou dispute, pelo status do pagamento; estornada: retido por
-- refund (a); a retenção que volta (contestação ganha), sem outra pendência na
-- comissão do pedido: o repasse volta a solicitado. A bloqueada já retém pelo
-- set_referrer_tax_id (e). O repasse em processamento é do Pix de saída (PR 9c).
CREATE FUNCTION payout_follows_commission() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NEW.status = 'held' THEN
      UPDATE public.payouts
      SET status = 'held', updated_at = now(),
          hold_reason = CASE
            WHEN (SELECT p.status FROM public.payments p WHERE p.id = NEW.payment_id) = 'disputed'
              THEN 'dispute'::payout_hold_reason
            ELSE 'refund'::payout_hold_reason END
      WHERE id = NEW.payout_id AND status = 'requested';
    ELSIF NEW.status = 'reversed' THEN
      UPDATE public.payouts
      SET status = 'held', hold_reason = 'refund', updated_at = now()
      WHERE id = NEW.payout_id AND status = 'requested';
    ELSIF OLD.status = 'held' AND NEW.status IN ('pending', 'available') THEN
      UPDATE public.payouts
      SET status = 'requested', hold_reason = NULL, updated_at = now()
      WHERE id = NEW.payout_id AND status = 'held' AND hold_reason IN ('refund', 'dispute')
        AND NOT EXISTS (
          SELECT 1 FROM public.commissions c
          WHERE c.payout_id = NEW.payout_id AND c.status IN ('held', 'reversed', 'blocked'));
    END IF;
    RETURN NULL;
  END
  $$;
ALTER FUNCTION payout_follows_commission() OWNER TO kore_rls;
REVOKE ALL ON FUNCTION payout_follows_commission() FROM PUBLIC;
CREATE TRIGGER trg_commissions_payout
  AFTER UPDATE OF status ON "commissions"
  FOR EACH ROW
  WHEN (NEW.payout_id IS NOT NULL AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION payout_follows_commission();

-- RN04 (decisão 247): o pedido, numa transação só, com o Referrer travado
-- (G2). Resultado e o que acompanha:
--   created · existing (a mesma Idempotency-Key e o mesmo valor): o repasse;
--   key_reused (a mesma chave com outro valor) · no_referrer;
--   data_missing (sem CPF ou CNPJ, ou sem chave ativa);
--   change_pending (troca da chave que ainda não vale): active_from;
--   payout_open (um repasse aberto): o id dele;
--   too_soon (30 dias do último pedido não recusado): next_request_at;
--   below_minimum · amount_changed: o saldo atual em amount_cents.
-- As comissões são tomadas por UPDATE … RETURNING, e o valor do repasse é a
-- soma do que voltou mais os ajustes sem repasse (B7-7).
CREATE FUNCTION request_referrer_payout(p_id uuid, p_idempotency_key uuid,
                                        p_expected_cents integer, p_external_ref text,
                                        p_now timestamptz)
  RETURNS TABLE (result text, payout_id uuid, amount_cents integer,
                 next_request_at timestamptz, active_from timestamptz)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  #variable_conflict use_column
  DECLARE
    v_referrer uuid := public.current_referrer_id();
    v_existing record;
    v_key record;
    v_pending timestamptz;
    v_open uuid;
    v_last timestamptz;
    v_next date;
    v_min integer;
    v_balance integer;
    v_taken integer;
  BEGIN
    IF v_referrer IS NULL THEN
      RETURN QUERY SELECT 'no_referrer'::text, NULL::uuid, NULL::integer, NULL::timestamptz,
        NULL::timestamptz;
      RETURN;
    END IF;
    PERFORM 1 FROM public.referrers WHERE id = v_referrer FOR UPDATE;
    PERFORM public.activate_due_referrer_pix_keys(p_now, v_referrer);

    SELECT p.id, p.amount_cents INTO v_existing FROM public.payouts p
    WHERE p.referrer_id = v_referrer AND p.idempotency_key = p_idempotency_key;
    IF v_existing.id IS NOT NULL THEN
      RETURN QUERY SELECT CASE WHEN v_existing.amount_cents = p_expected_cents
                               THEN 'existing' ELSE 'key_reused' END,
        v_existing.id, v_existing.amount_cents, NULL::timestamptz, NULL::timestamptz;
      RETURN;
    END IF;

    SELECT k.id, k.key_masked INTO v_key FROM public.referrer_pix_keys k
    WHERE k.referrer_id = v_referrer AND k.status = 'active';
    IF v_key.id IS NULL OR NOT EXISTS (SELECT 1 FROM public.referrers r
                                       WHERE r.id = v_referrer AND r.tax_id_hash IS NOT NULL) THEN
      RETURN QUERY SELECT 'data_missing'::text, NULL::uuid, NULL::integer, NULL::timestamptz,
        NULL::timestamptz;
      RETURN;
    END IF;

    SELECT k.active_from INTO v_pending FROM public.referrer_pix_keys k
    WHERE k.referrer_id = v_referrer AND k.status = 'pending_activation';
    IF v_pending IS NOT NULL THEN
      RETURN QUERY SELECT 'change_pending'::text, NULL::uuid, NULL::integer, NULL::timestamptz,
        v_pending;
      RETURN;
    END IF;

    SELECT p.id INTO v_open FROM public.payouts p
    WHERE p.referrer_id = v_referrer AND p.status IN ('requested', 'held', 'processing');
    IF v_open IS NOT NULL THEN
      RETURN QUERY SELECT 'payout_open'::text, v_open, NULL::integer, NULL::timestamptz,
        NULL::timestamptz;
      RETURN;
    END IF;

    -- Decisão 247(4): o dia do último pedido não recusado, em São Paulo, + 30.
    SELECT max(p.requested_at) INTO v_last FROM public.payouts p
    WHERE p.referrer_id = v_referrer AND p.status <> 'rejected';
    IF v_last IS NOT NULL THEN
      v_next := (v_last AT TIME ZONE 'America/Sao_Paulo')::date + 30;
      IF (p_now AT TIME ZONE 'America/Sao_Paulo')::date < v_next THEN
        RETURN QUERY SELECT 'too_soon'::text, NULL::uuid, NULL::integer,
          (v_next::timestamp AT TIME ZONE 'America/Sao_Paulo'), NULL::timestamptz;
        RETURN;
      END IF;
    END IF;

    SELECT s.payout_min_cents INTO v_min FROM public.referral_settings s
    ORDER BY s.created_at DESC LIMIT 1;
    SELECT COALESCE((SELECT sum(c.amount_cents) FROM public.commissions c
                     WHERE c.referrer_id = v_referrer AND c.status = 'available'
                       AND c.payout_id IS NULL), 0)
         + COALESCE((SELECT sum(a.amount_cents) FROM public.commission_adjustments a
                     WHERE a.referrer_id = v_referrer AND a.payout_id IS NULL), 0)
      INTO v_balance;
    IF v_balance < COALESCE(v_min, 5000) THEN
      RETURN QUERY SELECT 'below_minimum'::text, NULL::uuid, v_balance, NULL::timestamptz,
        NULL::timestamptz;
      RETURN;
    END IF;
    IF v_balance <> p_expected_cents THEN
      RETURN QUERY SELECT 'amount_changed'::text, NULL::uuid, v_balance, NULL::timestamptz,
        NULL::timestamptz;
      RETURN;
    END IF;

    BEGIN
      INSERT INTO public.payouts (id, created_at, updated_at, referrer_id, amount_cents, status,
                                  pix_key_id, pix_key_masked, external_ref, idempotency_key,
                                  requested_at)
      VALUES (p_id, p_now, now(), v_referrer, v_balance, 'requested', v_key.id, v_key.key_masked,
              p_external_ref, p_idempotency_key, p_now);
      WITH taken AS (
        UPDATE public.commissions c SET payout_id = p_id, updated_at = now()
        WHERE c.referrer_id = v_referrer AND c.status = 'available' AND c.payout_id IS NULL
        RETURNING c.amount_cents),
      adjusted AS (
        UPDATE public.commission_adjustments a SET payout_id = p_id
        WHERE a.referrer_id = v_referrer AND a.payout_id IS NULL
        RETURNING a.amount_cents)
      SELECT COALESCE((SELECT sum(amount_cents) FROM taken), 0)
           + COALESCE((SELECT sum(amount_cents) FROM adjusted), 0)
        INTO v_taken;
      IF v_taken <> p_expected_cents THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'amount_changed';
      END IF;
    EXCEPTION
      WHEN unique_violation THEN
        RETURN QUERY SELECT 'payout_open'::text,
          (SELECT p.id FROM public.payouts p WHERE p.referrer_id = v_referrer
             AND p.status IN ('requested', 'held', 'processing')),
          NULL::integer, NULL::timestamptz, NULL::timestamptz;
        RETURN;
      WHEN SQLSTATE 'P0001' THEN
        RETURN QUERY SELECT 'amount_changed'::text, NULL::uuid, v_taken, NULL::timestamptz,
          NULL::timestamptz;
        RETURN;
    END;
    RETURN QUERY SELECT 'created'::text, p_id, v_taken, NULL::timestamptz, NULL::timestamptz;
  END
  $$;
ALTER FUNCTION request_referrer_payout(uuid, uuid, integer, text, timestamptz) OWNER TO kore_rls;
REVOKE ALL ON FUNCTION request_referrer_payout(uuid, uuid, integer, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_referrer_payout(uuid, uuid, integer, text, timestamptz)
  TO kore_app;
