-- Decisão 248(2): o kore_app (a API, pela conexão kore_api) não publica o site
-- por fora do pagamento. Nenhum caso de uso da API grava o published_at: o
-- GRANT sai. O status ela grava, mas só em duas trocas (o convite do casal,
-- draft → awaiting_couple, e o aceite, awaiting_couple → draft): o trigger
-- abaixo recusa qualquer outra troca feita pelo kore_app, o que inclui publicar.
-- Quem publica é o backoffice, depois de aplicar o pagamento (Publicar e pagar
-- RN05), e as funções SECURITY DEFINER rodam como kore_rls: os dois passam.
REVOKE UPDATE ("published_at") ON "weddings" FROM kore_app;

CREATE FUNCTION weddings_app_status_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
  BEGIN
    -- O pg_has_role diz sim a todo superusuário (o dono do schema nas migrations).
    IF pg_has_role(current_user, 'kore_app', 'MEMBER')
       AND NOT (SELECT r.rolsuper FROM pg_roles r WHERE r.rolname = current_user)
       AND NOT ((OLD.status = 'draft' AND NEW.status = 'awaiting_couple')
                OR (OLD.status = 'awaiting_couple' AND NEW.status = 'draft')) THEN
      RAISE EXCEPTION 'weddings_app_status_guard: a API não muda o status de % para %',
        OLD.status, NEW.status
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END
  $$;
REVOKE ALL ON FUNCTION weddings_app_status_guard() FROM PUBLIC;
CREATE TRIGGER trg_weddings_app_status_guard
  BEFORE UPDATE OF status ON "weddings"
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION weddings_app_status_guard();
