-- Pagamentos e arrependimento (card 75, PR 5a): o pedido de desistência pelo
-- app (RN02 a RN04 e RN08), por função SECURITY DEFINER, porque o kore_app não
-- tem UPDATE em payments (Publicar e pagar RN20). O estorno pela porta vem
-- depois do commit, por job (RN04; G1).

GRANT UPDATE ("status", "refund_origin", "refund_requested_at", "refund_requested_by_user_id",
              "refund_reason", "updated_at")
  ON "payments" TO kore_rls;
GRANT UPDATE ("status", "end_date", "paid_through", "publication_source", "updated_at")
  ON "weddings" TO kore_rls;
GRANT SELECT ON "courtesy_extensions" TO kore_rls;
-- O INSERT … ON CONFLICT do alerta lê as colunas do índice único dos abertos.
GRANT INSERT ON "alerts" TO kore_rls;
GRANT SELECT ("type", "entity_type", "entity_id", "status") ON "alerts" TO kore_rls;

-- Desistir de um pagamento (Pagamentos e arrependimento RN02 a RN04 e RN08),
-- só de um casamento de que a pessoa é dona, com as travas na ordem única
-- (Wedding → Payment; Publicar e pagar RN18):
--   * o pagamento pago e aplicado, até o fim do 7º dia depois do paid_at, no
--     fuso do casamento; o casamento não bloqueado;
--   * a extensão só se for a última, contando as cortesias do Admin (B3-5);
--   * a publicação leva as extensões pagas junto (N estornos independentes) e o
--     casamento volta a rascunho, sem endDate, paidThrough nem origem (RN03 e RN07);
--   * a extensão volta a data a min(atual, anterior) e o paidThrough ao anterior;
--   * o 2º reembolso de publicação do casamento abre o alerta repeated_refund.
-- O requested_at vem do app (o relógio injetado, RN10): só o caso de uso da
-- requisição a chama, com a hora do pedido.
-- Devolve o resultado, os pagamentos que passaram a refund_requested e o último
-- instante do prazo (refundableUntil, para o Toast do 409). O id do
-- alerta vem do app (UUID v7).
CREATE FUNCTION request_payment_refund(wedding uuid, payment uuid, reason text,
                                       requested_at timestamptz, alert_id uuid)
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
    -- Só o pagamento do casamento do pedido (o da URL), e só se a pessoa é dona dele.
    SELECT p.* INTO target FROM public.payments p
    WHERE p.id = request_payment_refund.payment
      AND p.wedding_id = request_payment_refund.wedding
      AND request_payment_refund.wedding IN (SELECT public.owned_wedding_ids());
    IF NOT FOUND THEN
      RETURN QUERY SELECT 'not_found'::text, ARRAY[]::uuid[], NULL::timestamptz;
      RETURN;
    END IF;

    -- A ordem única de trava: o casamento, depois os pagamentos.
    SELECT * INTO w FROM public.weddings WHERE id = target.wedding_id FOR UPDATE;
    SELECT p.* INTO target FROM public.payments p WHERE p.id = target.id FOR UPDATE;

    IF w.blocked_at IS NOT NULL THEN
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
    IF request_payment_refund.requested_at >= window_end THEN
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
          updated_at = request_payment_refund.requested_at
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
          updated_at = request_payment_refund.requested_at
      WHERE id = w.id;
      -- RN08: o 2º reembolso de publicação do casamento.
      IF EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.wedding_id = target.wedding_id AND p.kind = 'publication' AND p.id <> target.id
          AND p.status IN ('refund_requested', 'refunded')
      ) THEN
        INSERT INTO public.alerts (id, type, wedding_id, entity_type, entity_id, data)
        VALUES (request_payment_refund.alert_id, 'repeated_refund', target.wedding_id, 'payment',
                target.id::text, jsonb_build_object('shortCode', target.short_code))
        ON CONFLICT (type, entity_type, entity_id) WHERE status = 'open' DO NOTHING;
      END IF;
    END IF;

    UPDATE public.payments p
    SET status = 'refund_requested', refund_origin = 'couple',
        refund_requested_at = request_payment_refund.requested_at,
        refund_requested_by_user_id = public.current_user_id(),
        refund_reason = NULLIF(btrim(request_payment_refund.reason), ''),
        updated_at = request_payment_refund.requested_at
    WHERE p.id = ANY (ids);

    RETURN QUERY SELECT 'requested'::text, ids, window_end - interval '1 millisecond';
  END
  $$;
ALTER FUNCTION request_payment_refund(uuid, uuid, text, timestamptz, uuid) OWNER TO kore_rls;
REVOKE ALL ON FUNCTION request_payment_refund(uuid, uuid, text, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_payment_refund(uuid, uuid, text, timestamptz, uuid) TO kore_app;
