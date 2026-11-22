-- O reembolso da publicação em carência ou expirado (Backoffice - cobrança RN05:
-- o Admin reembolsa a qualquer momento) volta o casamento a rascunho e limpa
-- também grace_until, expired_at, purge_at e purge_notice_sent_at. O dono, os
-- grants e a request_payment_refund (que só chama esta) ficam como estão; o
-- kore_rls, dono da função, passa a gravar as três colunas do ciclo que ainda
-- não gravava.

GRANT UPDATE ("expired_at", "purge_at", "purge_notice_sent_at") ON "weddings" TO kore_rls;

CREATE OR REPLACE FUNCTION apply_payment_refund(wedding uuid, payment uuid, reason text,
                                     requested_at timestamptz, alert_id uuid,
                                     origin refund_origin, by_user_id uuid, couple boolean)
  RETURNS TABLE (result text, payment_ids uuid[], refundable_until timestamptz)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    target public.payments%ROWTYPE;
    w public.weddings%ROWTYPE;
    ids uuid[];
    window_end timestamptz;
  BEGIN
    -- Só o pagamento do casamento do pedido (o da URL); o do casal, só se a
    -- pessoa é dona dele (o Admin vem pela conexão do backoffice).
    SELECT p.* INTO target FROM public.payments p
    WHERE p.id = apply_payment_refund.payment
      AND p.wedding_id = apply_payment_refund.wedding
      AND (NOT apply_payment_refund.couple
           OR apply_payment_refund.wedding IN (SELECT public.owned_wedding_ids()));
    IF NOT FOUND THEN
      RETURN QUERY SELECT 'not_found'::text, ARRAY[]::uuid[], NULL::timestamptz;
      RETURN;
    END IF;

    -- A ordem única de trava: o casamento, depois os pagamentos.
    SELECT * INTO w FROM public.weddings WHERE id = target.wedding_id FOR UPDATE;
    SELECT p.* INTO target FROM public.payments p WHERE p.id = target.id FOR UPDATE;

    -- O casal não desiste com o casamento bloqueado; o Admin reembolsa (decisão 86).
    IF apply_payment_refund.couple AND w.blocked_at IS NOT NULL THEN
      RETURN QUERY SELECT 'blocked'::text, ARRAY[]::uuid[], NULL::timestamptz;
      RETURN;
    END IF;
    IF target.status IN ('refund_requested', 'refunded') THEN
      RETURN QUERY SELECT 'already_requested'::text, ARRAY[]::uuid[], NULL::timestamptz;
      RETURN;
    END IF;
    IF target.status = 'disputed' THEN
      RETURN QUERY SELECT 'disputed'::text, ARRAY[]::uuid[], NULL::timestamptz;
      RETURN;
    END IF;
    IF target.status <> 'paid' OR target.applied_at IS NULL OR target.paid_at IS NULL THEN
      RETURN QUERY SELECT 'not_paid'::text, ARRAY[]::uuid[], NULL::timestamptz;
      RETURN;
    END IF;

    -- RN02: até o fim do 7º dia depois do pagamento, no fuso do casamento.
    -- O fuso nulo (casamento antigo) conta como o de São Paulo.
    window_end := (((target.paid_at AT TIME ZONE COALESCE(w.timezone, 'America/Sao_Paulo'))::date
                    + 8)::timestamp) AT TIME ZONE COALESCE(w.timezone, 'America/Sao_Paulo');
    -- O prazo de 7 dias é só do casal: o Admin reembolsa a qualquer momento (RN05).
    IF apply_payment_refund.couple AND apply_payment_refund.requested_at >= window_end THEN
      RETURN QUERY SELECT 'window_closed'::text, ARRAY[]::uuid[],
                          window_end - interval '1 millisecond';
      RETURN;
    END IF;

    IF target.kind = 'extension' THEN
      -- RN03 (B3-5): só a última, contando as cortesias do Admin.
      IF EXISTS (
        SELECT 1 FROM public.payments e
        WHERE e.wedding_id = target.wedding_id AND e.kind = 'extension' AND e.id <> target.id
          AND e.applied_at IS NOT NULL AND e.status IN ('paid', 'disputed')
          AND e.period_start > target.period_start
      ) OR EXISTS (
        SELECT 1 FROM public.courtesy_extensions c
        WHERE c.wedding_id = target.wedding_id AND c.period_start >= target.period_end
      ) THEN
        RETURN QUERY SELECT 'not_last_extension'::text, ARRAY[]::uuid[], NULL::timestamptz;
        RETURN;
      END IF;
      ids := ARRAY[target.id];
      UPDATE public.weddings
      SET end_date = LEAST(w.end_date, target.previous_end_date),
          paid_through = target.previous_paid_through,
          updated_at = apply_payment_refund.requested_at
      WHERE id = w.id;
    ELSE
      -- RN03: a publicação leva as extensões pagas por cima, cada uma com o seu estorno.
      SELECT array_agg(p.id ORDER BY p.period_start) INTO ids
      FROM public.payments p
      WHERE p.wedding_id = target.wedding_id
        AND (p.id = target.id
             OR (p.kind = 'extension' AND p.status = 'paid' AND p.applied_at IS NOT NULL));
      PERFORM 1 FROM public.payments p WHERE p.id = ANY (ids) FOR UPDATE;
      UPDATE public.weddings
      -- Sem endDate, sem origem (chk_weddings_publication_source); o publishedAt fica.
      SET status = 'draft', end_date = NULL, paid_through = NULL, publication_source = NULL,
          -- Em carência ou expirado: o ciclo sai junto (chk_weddings_lifecycle_dates),
          -- senão a próxima publicação não passa (revisão do Crivo no 12b).
          grace_until = NULL, expired_at = NULL, purge_at = NULL, purge_notice_sent_at = NULL,
          updated_at = apply_payment_refund.requested_at
      WHERE id = w.id;
      -- RN08: o 2º reembolso de publicação do casamento.
      IF EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.wedding_id = target.wedding_id AND p.kind = 'publication' AND p.id <> target.id
          AND p.status IN ('refund_requested', 'refunded')
      ) THEN
        INSERT INTO public.alerts (id, type, wedding_id, entity_type, entity_id, data)
        VALUES (apply_payment_refund.alert_id, 'repeated_refund', target.wedding_id, 'payment',
                target.id::text, jsonb_build_object('shortCode', target.short_code))
        ON CONFLICT (type, entity_type, entity_id) WHERE status = 'open' DO NOTHING;
      END IF;
    END IF;

    UPDATE public.payments p
    SET status = 'refund_requested', refund_origin = apply_payment_refund.origin,
        refund_requested_at = apply_payment_refund.requested_at,
        refund_requested_by_user_id = apply_payment_refund.by_user_id,
        refund_reason = NULLIF(btrim(apply_payment_refund.reason), ''),
        updated_at = apply_payment_refund.requested_at
    WHERE p.id = ANY (ids);

    -- Comissões RN05 (B3-7): a comissão pending ou available de cada pagamento
    -- fica retida já no pedido, para não entrar num repasse enquanto o estorno
    -- corre; a bloqueada continua bloqueada.
    UPDATE public.commissions c
    SET status = 'held', updated_at = apply_payment_refund.requested_at
    WHERE c.payment_id = ANY (ids) AND c.status IN ('pending', 'available');

    RETURN QUERY SELECT 'requested'::text, ids, window_end - interval '1 millisecond';
  END
  $$;

