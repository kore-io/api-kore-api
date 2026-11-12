-- Push (E-mail e push RN07; revisão técnica R8-7): uma assinatura com o mesmo
-- endpoint registrada por outra pessoa (o aparelho trocou de dono) passa para a
-- sessão atual. A RLS só mostra as linhas da própria pessoa, então a linha
-- alheia sai por esta função, que apaga só ela; a nova é gravada pela API, sob
-- a RLS, como da pessoa da requisição.
GRANT SELECT, DELETE ON "push_subscriptions" TO kore_rls;
CREATE FUNCTION release_push_endpoint(push_endpoint text) RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    DELETE FROM public.push_subscriptions
    WHERE endpoint = release_push_endpoint.push_endpoint
      AND user_id <> public.current_user_id()
      AND public.current_user_id() IS NOT NULL
  $$;
ALTER FUNCTION release_push_endpoint(text) OWNER TO kore_rls;
REVOKE ALL ON FUNCTION release_push_endpoint(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION release_push_endpoint(text) TO kore_app;
