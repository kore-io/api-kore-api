-- Publicar e pagar (card 75, PR 4a): a gravação do passo 3 da RN03 pelo app e
-- a notificação da primeira publicação pelo worker (RN05; revisão técnica G5).

-- RN03, passo 3 (RN20): o kore_app não tem UPDATE em payments. A função grava
-- o que o gateway devolveu, só num pagamento pendente, ainda sem id do
-- gateway, de um casamento de que a pessoa é dona. O cartão recusado na hora
-- passa a failed, com o motivo; o resto do estado é do worker.
GRANT UPDATE ("gateway_payment_id", "pix_copy_paste", "due_at", "card_last4", "status",
              "failure_reason", "updated_at")
  ON "payments" TO kore_rls;
CREATE FUNCTION record_payment_charge(payment uuid, gateway_payment_id text, refused boolean,
                                      pix_copy_paste text, due_at timestamptz, card_last4 text,
                                      failure_reason text) RETURNS boolean
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    WITH updated AS (
      UPDATE public.payments p
      SET gateway_payment_id = record_payment_charge.gateway_payment_id,
          pix_copy_paste = record_payment_charge.pix_copy_paste,
          due_at = record_payment_charge.due_at,
          card_last4 = record_payment_charge.card_last4,
          status = CASE WHEN record_payment_charge.refused THEN 'failed'::payment_status
                        ELSE p.status END,
          failure_reason = CASE WHEN record_payment_charge.refused
                                THEN record_payment_charge.failure_reason END,
          updated_at = now()
      WHERE p.id = record_payment_charge.payment AND p.status = 'pending'
        AND p.gateway_payment_id IS NULL
        AND p.wedding_id IN (SELECT public.owned_wedding_ids())
      RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM updated)
  $$;
ALTER FUNCTION record_payment_charge(uuid, text, boolean, text, timestamptz, text, text) OWNER TO kore_rls;
REVOKE ALL ON FUNCTION record_payment_charge(uuid, text, boolean, text, timestamptz, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_payment_charge(uuid, text, boolean, text, timestamptz, text, text) TO kore_app;

-- RN05 (G5): a variante da notify_wedding_published para o worker, que aplica o
-- pagamento fora da transação do casal (sem current_wedding_id nem dono). Os
-- mesmos destinatários e o mesmo único do tipo; só no casamento publicado.
CREATE FUNCTION notify_wedding_published_for(wedding uuid, notification_ids uuid[]) RETURNS uuid[]
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    recipients uuid[];
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.weddings w
                   WHERE w.id = notify_wedding_published_for.wedding AND w.published_at IS NOT NULL) THEN
      RAISE EXCEPTION 'notify_wedding_published_for: casamento não publicado';
    END IF;
    WITH people AS (
      SELECT r.user_id FROM public.weddings w
      JOIN public.referrers r ON r.id = w.referrer_id AND r.kind = 'planner' AND r.status = 'active'
      WHERE w.id = notify_wedding_published_for.wedding
      UNION
      SELECT m.user_id FROM public.memberships m
      JOIN public.referrers r ON r.user_id = m.user_id AND r.kind = 'planner' AND r.status = 'active'
      JOIN public.planners p ON p.referrer_id = r.id
      WHERE m.wedding_id = notify_wedding_published_for.wedding AND m.role = 'collaborator'
        AND m.removed_at IS NULL
    ), numbered AS (
      SELECT user_id, row_number() OVER (ORDER BY user_id) AS n FROM people
    ), written AS (
      INSERT INTO public.notifications (id, user_id, wedding_id, type, group_key, count, payload)
      SELECT notify_wedding_published_for.notification_ids[n], user_id,
             notify_wedding_published_for.wedding, 'wedding_published',
             'wedding_published:' || notify_wedding_published_for.wedding, 1,
             jsonb_build_array(jsonb_build_object(
               'partnerNames', public.wedding_partner_names(notify_wedding_published_for.wedding)))
      FROM numbered
      ON CONFLICT DO NOTHING
      RETURNING user_id
    )
    SELECT coalesce(array_agg(user_id), '{}') INTO recipients FROM written;
    RETURN recipients;
  END
  $$;
ALTER FUNCTION notify_wedding_published_for(uuid, uuid[]) OWNER TO kore_rls;
REVOKE ALL ON FUNCTION notify_wedding_published_for(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notify_wedding_published_for(uuid, uuid[]) TO kore_backoffice;
