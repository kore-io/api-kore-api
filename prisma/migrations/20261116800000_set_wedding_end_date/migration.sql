-- Antecipar e voltar a data de saída do ar (Data de saída do ar RN05; decisão
-- 231, B4-1): o caso de uso valida (limites, paidThrough, bloqueio) com o
-- casamento travado e grava por aqui, porque voltar a data de graça pode tirar
-- o casamento da carência, e o kore_app não grava a grace_until.
GRANT UPDATE ("end_date", "status", "grace_until", "updated_at") ON "weddings" TO kore_rls;

-- Só num casamento de que a pessoa é dona, publicado, em pós-evento ou em
-- carência. Na carência, a data nova (sempre a partir de amanhã) a encerra:
-- volta a published (casamento por vir) ou post_event, sem graceUntil.
CREATE FUNCTION set_wedding_end_date(wedding uuid, end_date date, today date,
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
      RETURNING w.status::text AS status
    )
    SELECT status FROM updated
  $$;
ALTER FUNCTION set_wedding_end_date(uuid, date, date, timestamptz) OWNER TO kore_rls;
REVOKE ALL ON FUNCTION set_wedding_end_date(uuid, date, date, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_wedding_end_date(uuid, date, date, timestamptz) TO kore_app;
