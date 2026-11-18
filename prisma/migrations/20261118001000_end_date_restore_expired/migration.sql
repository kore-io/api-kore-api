-- Decisão 289(1) (Data de saída do ar RN05 contra RN04): o voltar atrás de
-- graça vale também no expirado que ainda tem meses pagos à frente
-- (paid_through depois de hoje), para qualquer data de amanhã até o
-- paid_through. Ele volta a post_event (ou published, se a event_date não
-- passou), e expired_at, purge_at e purge_notice_sent_at ficam nulos, como na
-- extensão. O resto igual à 20261116900000 (limites, dono e grants).
CREATE OR REPLACE FUNCTION set_wedding_end_date(wedding uuid, end_date date, today date,
                                     changed_at timestamptz) RETURNS text
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    WITH updated AS (
      UPDATE public.weddings w
      SET end_date = set_wedding_end_date.end_date,
          status = CASE
            WHEN w.status IN ('grace', 'expired') AND w.event_date >= set_wedding_end_date.today
              THEN 'published'::wedding_status
            WHEN w.status IN ('grace', 'expired') THEN 'post_event'::wedding_status
            ELSE w.status END,
          grace_until = NULL,
          expired_at = CASE WHEN w.status = 'expired' THEN NULL ELSE w.expired_at END,
          purge_at = CASE WHEN w.status = 'expired' THEN NULL ELSE w.purge_at END,
          purge_notice_sent_at =
            CASE WHEN w.status = 'expired' THEN NULL ELSE w.purge_notice_sent_at END,
          updated_at = set_wedding_end_date.changed_at
      WHERE w.id = set_wedding_end_date.wedding
        AND w.status IN ('published', 'post_event', 'grace', 'expired')
        AND w.id IN (SELECT public.owned_wedding_ids())
        -- Defesa em profundidade (sugestão do Crivo no PR 6c): nenhum caminho
        -- estende de graça; o caso de uso já confere os mesmos limites. No
        -- expirado sem mês pago à frente, a end_date já passou e nada muda.
        AND set_wedding_end_date.end_date > set_wedding_end_date.today
        AND set_wedding_end_date.end_date <= coalesce(w.paid_through, w.end_date)
      RETURNING w.status::text AS status
    )
    SELECT status FROM updated
  $$;
