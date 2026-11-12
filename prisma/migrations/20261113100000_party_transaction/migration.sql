-- Transação do grupo (RSVP RN13; decisão 217(a)): o grupo identificado pelo
-- cookie escreve sob a RLS, com set_config('app.wedding_id') e
-- set_config('app.party_id'), por policies limitadas àquele grupo. Não há
-- função SECURITY DEFINER de escrita do grupo: a regra continua no domínio em
-- TypeScript. Sem app.party_id, nenhuma policy daqui casa (falha fechada).

-- Papel do grupo (revisão técnica T3: "ao kore_app e ao papel do grupo"): a
-- transação do grupo faz SET LOCAL ROLE kore_party, e o grupo só tem os
-- GRANTs abaixo. Com as policies no kore_app, o grupo herdaria as colunas da
-- API (renomear o grupo, mudar vagas, contato e observação interna). O
-- kore_app recebe o papel só para poder entrar nele (SET ROLE), sem herdar.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kore_party') THEN
    CREATE ROLE kore_party NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
GRANT kore_party TO kore_app WITH INHERIT FALSE, SET TRUE;
GRANT USAGE ON SCHEMA public TO kore_party;
-- As policies por vínculo das mesmas tabelas também são avaliadas no papel do
-- grupo; sem app.user_id, as duas funções devolvem vazio.
GRANT EXECUTE ON FUNCTION active_wedding_ids(), owned_wedding_ids() TO kore_party;

-- Grupo da transação corrente. Sem valor, NULL.
CREATE FUNCTION current_party_id() RETURNS uuid
  LANGUAGE sql
  STABLE
  AS $$ SELECT NULLIF(current_setting('app.party_id', true), '')::uuid $$;

-- A primeira consulta da transação do grupo (RN13): reconfere o casamento, o
-- grupo, a versão do link e a lixeira, como a site_party_view, e devolve o que
-- o caso de uso precisa do casamento no ar. Fora do ar ou grupo inválido, nulo.
-- Só leitura; SECURITY DEFINER porque o grupo não lê weddings.
CREATE FUNCTION party_transaction_context(link_version integer) RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT jsonb_build_object(
      'status', w.status,
      'timezone', w.timezone,
      'eventDate', w.event_date,
      'rsvpDeadline', w.rsvp_deadline,
      'publishedAt', w.published_at,
      'songQuestionEnabled', w.song_question_enabled,
      'songQuestionText', w.song_question_text
    )
    FROM public.parties p
    JOIN public.weddings w ON w.id = p.wedding_id
    WHERE p.id = public.current_party_id() AND p.wedding_id = public.current_wedding_id()
      AND p.deleted_at IS NULL
      AND p.link_version = party_transaction_context.link_version
      AND w.status IN ('published', 'post_event', 'grace')
  $$;
GRANT SELECT ON "weddings" TO kore_rls;
ALTER FUNCTION party_transaction_context(integer) OWNER TO kore_rls;
REVOKE ALL ON FUNCTION party_transaction_context(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION party_transaction_context(integer) TO kore_party;

-- O que o grupo lê e grava (RSVP RN02 e RN07; Prazo RN07; Música RN04).
GRANT SELECT ON "parties", "guests", "rsvp_submissions", "wedding_stats" TO kore_party;
GRANT UPDATE ("version", "delivery_status", "first_viewed_at", "responded_at",
              "last_response_actor", "last_signed_by_guest_id", "last_response_user_id",
              "updated_at")
  ON "parties" TO kore_party;
GRANT UPDATE ("name", "rsvp_status", "responded_at", "dietary_restriction", "song_suggestion",
              "song_suggested_at", "updated_at")
  ON "guests" TO kore_party;
GRANT INSERT ON "rsvp_submissions", "guest_responses" TO kore_party;
GRANT UPDATE ("confirmed", "declined", "pending", "adults_confirmed", "children_confirmed",
              "babies_confirmed", "parties_pending", "updated_at")
  ON "wedding_stats" TO kore_party;

-- Policies *_party_* (RN13), só do papel do grupo: o grupo lê e muda só a
-- própria linha e os próprios convidados (sem trocar de grupo nem de
-- casamento), insere o próprio histórico como grupo, lê as próprias gravações
-- (teto do dia, RN10) e atualiza os números do próprio casamento.
CREATE POLICY "parties_party_select" ON "parties" FOR SELECT TO kore_party
  USING ("id" = current_party_id() AND "wedding_id" = current_wedding_id());
CREATE POLICY "parties_party_update" ON "parties" FOR UPDATE TO kore_party
  USING ("id" = current_party_id() AND "wedding_id" = current_wedding_id())
  WITH CHECK ("id" = current_party_id() AND "wedding_id" = current_wedding_id());
CREATE POLICY "guests_party_select" ON "guests" FOR SELECT TO kore_party
  USING ("party_id" = current_party_id() AND "wedding_id" = current_wedding_id());
CREATE POLICY "guests_party_update" ON "guests" FOR UPDATE TO kore_party
  USING ("party_id" = current_party_id() AND "wedding_id" = current_wedding_id())
  WITH CHECK ("party_id" = current_party_id() AND "wedding_id" = current_wedding_id());
CREATE POLICY "guest_responses_party_insert" ON "guest_responses" FOR INSERT TO kore_party
  WITH CHECK ("party_id" = current_party_id() AND "wedding_id" = current_wedding_id()
              AND "actor" = 'party');
CREATE POLICY "rsvp_submissions_party_select" ON "rsvp_submissions" FOR SELECT TO kore_party
  USING ("party_id" = current_party_id() AND "wedding_id" = current_wedding_id());
CREATE POLICY "rsvp_submissions_party_insert" ON "rsvp_submissions" FOR INSERT TO kore_party
  WITH CHECK ("party_id" = current_party_id() AND "wedding_id" = current_wedding_id()
              AND "actor" = 'party');
CREATE POLICY "wedding_stats_party_select" ON "wedding_stats" FOR SELECT TO kore_party
  USING (current_party_id() IS NOT NULL AND "wedding_id" = current_wedding_id());
CREATE POLICY "wedding_stats_party_update" ON "wedding_stats" FOR UPDATE TO kore_party
  USING (current_party_id() IS NOT NULL AND "wedding_id" = current_wedding_id())
  WITH CHECK ("wedding_id" = current_wedding_id());
