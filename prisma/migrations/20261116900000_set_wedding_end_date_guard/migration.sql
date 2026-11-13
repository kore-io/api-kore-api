-- Casamento bloqueado (PR 7) leva junto a sugestão do Crivo no PR 6c: a
-- set_wedding_end_date repete os limites da RN05 da Data de saída do ar (a data
-- nova depois de hoje e até o paidThrough; sem ele, até a endDate atual).
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
            WHEN w.status = 'grace' AND w.event_date >= set_wedding_end_date.today
              THEN 'published'::wedding_status
            WHEN w.status = 'grace' THEN 'post_event'::wedding_status
            ELSE w.status END,
          grace_until = NULL,
          updated_at = set_wedding_end_date.changed_at
      WHERE w.id = set_wedding_end_date.wedding
        AND w.status IN ('published', 'post_event', 'grace')
        AND w.id IN (SELECT public.owned_wedding_ids())
        -- Defesa em profundidade (sugestão do Crivo no PR 6c): nenhum caminho
        -- estende de graça; o caso de uso já confere os mesmos limites.
        AND set_wedding_end_date.end_date > set_wedding_end_date.today
        AND set_wedding_end_date.end_date <= coalesce(w.paid_through, w.end_date)
      RETURNING w.status::text AS status
    )
    SELECT status FROM updated
  $$;
