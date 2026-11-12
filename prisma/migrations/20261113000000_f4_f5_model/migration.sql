-- Modelo das F4 e F5 (card 71): publicação por Cortesia, RSVP, prazo e respostas
-- pelo casal, envios, pergunta de música, notificações, e-mail e push.
-- Specs das F4 e F5; decisões 216 e 217.
-- CreateEnum
CREATE TYPE "publication_source" AS ENUM ('courtesy', 'payment');

-- CreateEnum
CREATE TYPE "delivery_channel" AS ENUM ('whatsapp', 'email', 'link', 'qr');

-- CreateEnum
CREATE TYPE "delivery_kind" AS ENUM ('invite', 'save_the_date', 'reminder');

-- CreateEnum
CREATE TYPE "response_actor" AS ENUM ('party', 'couple');

-- CreateEnum
CREATE TYPE "notification_type" AS ENUM ('rsvp');

-- CreateEnum
CREATE TYPE "email_frequency" AS ENUM ('off', 'immediate', 'daily');

-- AlterEnum

ALTER TYPE "product_event_name" ADD VALUE 'publicado';
ALTER TYPE "product_event_name" ADD VALUE 'grupo_enviado';
ALTER TYPE "product_event_name" ADD VALUE 'primeira_resposta';

-- AlterTable
ALTER TABLE "weddings" ADD COLUMN     "end_date" DATE,
ADD COLUMN     "paid_through" DATE,
ADD COLUMN     "publication_source" "publication_source",
ADD COLUMN     "published_by_user_id" UUID,
ADD COLUMN     "rsvp_deadline" DATE,
ADD COLUMN     "song_question_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "song_question_text" TEXT;

-- AlterTable
ALTER TABLE "parties" ADD COLUMN     "last_channel" "delivery_channel",
ADD COLUMN     "last_reminder_at" TIMESTAMPTZ(3),
ADD COLUMN     "last_response_actor" "response_actor",
ADD COLUMN     "last_response_user_id" UUID,
ADD COLUMN     "last_signed_by_guest_id" UUID,
ADD COLUMN     "save_the_date_sent_at" TIMESTAMPTZ(3),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "guests" ADD COLUMN     "song_suggested_at" TIMESTAMPTZ(3),
ADD COLUMN     "song_suggestion" TEXT;

-- CreateTable
CREATE TABLE "rsvp_submissions" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "wedding_id" UUID NOT NULL,
    "party_id" UUID NOT NULL,
    "actor" "response_actor" NOT NULL,
    "signed_by_guest_id" UUID,
    "actor_user_id" UUID,
    "confirmed_count" INTEGER NOT NULL,
    "declined_count" INTEGER NOT NULL,

    CONSTRAINT "rsvp_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_responses" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "wedding_id" UUID NOT NULL,
    "guest_id" UUID NOT NULL,
    "party_id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "status" "rsvp_status" NOT NULL,
    "signed_by_guest_id" UUID,
    "actor" "response_actor" NOT NULL,
    "actor_user_id" UUID,

    CONSTRAINT "guest_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_templates" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "wedding_id" UUID NOT NULL,
    "kind" "delivery_kind" NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "updated_by_user_id" UUID,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "party_deliveries" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "wedding_id" UUID NOT NULL,
    "party_id" UUID NOT NULL,
    "kind" "delivery_kind" NOT NULL,
    "channel" "delivery_channel" NOT NULL,
    "user_id" UUID,

    CONSTRAINT "party_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID NOT NULL,
    "wedding_id" UUID NOT NULL,
    "type" "notification_type" NOT NULL,
    "group_key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "read_at" TIMESTAMPTZ(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" UUID NOT NULL,
    "wedding_id" UUID,
    "type" "notification_type" NOT NULL,
    "in_app" BOOLEAN NOT NULL DEFAULT true,
    "email" "email_frequency" NOT NULL DEFAULT 'daily',
    "push" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_email_states" (
    "user_id" UUID NOT NULL,
    "wedding_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "emailed_through" TIMESTAMPTZ(3),
    "last_immediate_at" TIMESTAMPTZ(3),
    "last_digest_date" DATE,

    CONSTRAINT "notification_email_states_pkey" PRIMARY KEY ("user_id","wedding_id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "last_success_at" TIMESTAMPTZ(3),

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_rsvp_submissions_party_id_created_at" ON "rsvp_submissions"("party_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_rsvp_submissions_wedding_id_actor_created_at" ON "rsvp_submissions"("wedding_id", "actor", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_rsvp_submissions_wedding_id_id" ON "rsvp_submissions"("wedding_id", "id");

-- CreateIndex
CREATE INDEX "idx_guest_responses_party_id_created_at" ON "guest_responses"("party_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_guest_responses_guest_id_created_at" ON "guest_responses"("guest_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_guest_responses_submission_id" ON "guest_responses"("submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_message_templates_wedding_id_kind" ON "message_templates"("wedding_id", "kind");

-- CreateIndex
CREATE INDEX "idx_party_deliveries_party_id_created_at" ON "party_deliveries"("party_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_party_deliveries_wedding_id" ON "party_deliveries"("wedding_id");

-- CreateIndex
CREATE INDEX "idx_notifications_user_id_wedding_id_updated_at" ON "notifications"("user_id", "wedding_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "idx_notifications_wedding_id" ON "notifications"("wedding_id");

-- CreateIndex
CREATE INDEX "idx_notification_preferences_wedding_id" ON "notification_preferences"("wedding_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_notification_preferences_user_id_wedding_id_type" ON "notification_preferences"("user_id", "wedding_id", "type");

-- CreateIndex
CREATE INDEX "idx_notification_email_states_wedding_id" ON "notification_email_states"("wedding_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_push_subscriptions_endpoint" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "idx_push_subscriptions_user_id" ON "push_subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "idx_push_subscriptions_session_id" ON "push_subscriptions"("session_id");

-- CreateIndex
CREATE INDEX "idx_weddings_published_by_user_id" ON "weddings"("published_by_user_id");

-- AddForeignKey
ALTER TABLE "weddings" ADD CONSTRAINT "weddings_published_by_user_id_fkey" FOREIGN KEY ("published_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parties" ADD CONSTRAINT "parties_last_response_user_id_fkey" FOREIGN KEY ("last_response_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rsvp_submissions" ADD CONSTRAINT "rsvp_submissions_wedding_id_fkey" FOREIGN KEY ("wedding_id") REFERENCES "weddings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rsvp_submissions" ADD CONSTRAINT "rsvp_submissions_wedding_id_party_id_fkey" FOREIGN KEY ("wedding_id", "party_id") REFERENCES "parties"("wedding_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rsvp_submissions" ADD CONSTRAINT "rsvp_submissions_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_responses" ADD CONSTRAINT "guest_responses_wedding_id_fkey" FOREIGN KEY ("wedding_id") REFERENCES "weddings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_responses" ADD CONSTRAINT "guest_responses_wedding_id_guest_id_fkey" FOREIGN KEY ("wedding_id", "guest_id") REFERENCES "guests"("wedding_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_responses" ADD CONSTRAINT "guest_responses_wedding_id_party_id_fkey" FOREIGN KEY ("wedding_id", "party_id") REFERENCES "parties"("wedding_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_responses" ADD CONSTRAINT "guest_responses_wedding_id_submission_id_fkey" FOREIGN KEY ("wedding_id", "submission_id") REFERENCES "rsvp_submissions"("wedding_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_responses" ADD CONSTRAINT "guest_responses_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_wedding_id_fkey" FOREIGN KEY ("wedding_id") REFERENCES "weddings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_deliveries" ADD CONSTRAINT "party_deliveries_wedding_id_fkey" FOREIGN KEY ("wedding_id") REFERENCES "weddings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_deliveries" ADD CONSTRAINT "party_deliveries_wedding_id_party_id_fkey" FOREIGN KEY ("wedding_id", "party_id") REFERENCES "parties"("wedding_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_deliveries" ADD CONSTRAINT "party_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_wedding_id_fkey" FOREIGN KEY ("wedding_id") REFERENCES "weddings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_wedding_id_fkey" FOREIGN KEY ("wedding_id") REFERENCES "weddings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_email_states" ADD CONSTRAINT "notification_email_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_email_states" ADD CONSTRAINT "notification_email_states_wedding_id_fkey" FOREIGN KEY ("wedding_id") REFERENCES "weddings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- SQL manual (ADR do Prisma; ADR de multi-tenant; revisão técnica T3: GRANT
-- UPDATE por coluna; decisões 216 e 217) ------------------------------------

-- Isolamento (Modelo de Dados, invariante 1): o assinante e a última resposta
-- apontam para um convidado do mesmo casamento. O expurgo do convidado apaga só
-- a referência (SET NULL da coluna, PG 15+): o histórico mostra "Respondido
-- pelo grupo" (RSVP, revisão técnica R2-10).
ALTER TABLE "parties" ADD CONSTRAINT "parties_last_signed_by_guest_fkey"
  FOREIGN KEY ("wedding_id", "last_signed_by_guest_id") REFERENCES "guests" ("wedding_id", "id")
  ON DELETE SET NULL ("last_signed_by_guest_id");
CREATE INDEX "idx_parties_last_signed_by_guest_id" ON "parties" ("last_signed_by_guest_id")
  WHERE "last_signed_by_guest_id" IS NOT NULL;
ALTER TABLE "rsvp_submissions" ADD CONSTRAINT "rsvp_submissions_signed_by_guest_fkey"
  FOREIGN KEY ("wedding_id", "signed_by_guest_id") REFERENCES "guests" ("wedding_id", "id")
  ON DELETE SET NULL ("signed_by_guest_id");
CREATE INDEX "idx_rsvp_submissions_signed_by_guest_id" ON "rsvp_submissions" ("signed_by_guest_id")
  WHERE "signed_by_guest_id" IS NOT NULL;
ALTER TABLE "guest_responses" ADD CONSTRAINT "guest_responses_signed_by_guest_fkey"
  FOREIGN KEY ("wedding_id", "signed_by_guest_id") REFERENCES "guests" ("wedding_id", "id")
  ON DELETE SET NULL ("signed_by_guest_id");
CREATE INDEX "idx_guest_responses_signed_by_guest_id" ON "guest_responses" ("signed_by_guest_id")
  WHERE "signed_by_guest_id" IS NOT NULL;

-- Limites e formatos.
-- Data de saída do ar depois do casamento (Publicação RN04); a publicação tem
-- data e origem juntas (RN05).
ALTER TABLE "weddings" ADD CONSTRAINT "chk_weddings_end_date"
  CHECK ("end_date" IS NULL OR "event_date" IS NULL OR "end_date" > "event_date");
ALTER TABLE "weddings" ADD CONSTRAINT "chk_weddings_publication_source"
  CHECK ("publication_source" IS NULL OR ("published_at" IS NOT NULL AND "end_date" IS NOT NULL));
-- Pergunta de música (Música RN01): até 120.
ALTER TABLE "weddings" ADD CONSTRAINT "chk_weddings_song_question_text"
  CHECK ("song_question_text" IS NULL OR char_length("song_question_text") BETWEEN 1 AND 120);
ALTER TABLE "parties" ADD CONSTRAINT "chk_parties_version" CHECK ("version" >= 1);
-- Sugestão de música só de quem confirmou, com a data junto (Música RN04).
ALTER TABLE "guests" ADD CONSTRAINT "chk_guests_song_suggestion"
  CHECK ("song_suggestion" IS NULL
         OR (char_length("song_suggestion") BETWEEN 1 AND 120 AND "rsvp_status" = 'confirmed'));
ALTER TABLE "guests" ADD CONSTRAINT "chk_guests_song_suggested_at"
  CHECK (("song_suggestion" IS NULL) = ("song_suggested_at" IS NULL));
-- Quem assina é do grupo; quem altera é do casal (RSVP RN07; Prazo RN04).
ALTER TABLE "rsvp_submissions" ADD CONSTRAINT "chk_rsvp_submissions_actor"
  CHECK (("actor" = 'party' AND "actor_user_id" IS NULL)
         OR ("actor" = 'couple' AND "signed_by_guest_id" IS NULL));
ALTER TABLE "rsvp_submissions" ADD CONSTRAINT "chk_rsvp_submissions_counts"
  CHECK ("confirmed_count" >= 0 AND "declined_count" >= 0);
ALTER TABLE "guest_responses" ADD CONSTRAINT "chk_guest_responses_actor"
  CHECK (("actor" = 'party' AND "actor_user_id" IS NULL)
         OR ("actor" = 'couple' AND "signed_by_guest_id" IS NULL));
-- Mensagem pronta (Envios RN06): até 1.000; assunto até 120, sem quebra de linha.
ALTER TABLE "message_templates" ADD CONSTRAINT "chk_message_templates_body"
  CHECK (char_length("body") BETWEEN 1 AND 1000);
ALTER TABLE "message_templates" ADD CONSTRAINT "chk_message_templates_subject"
  CHECK ("subject" IS NULL OR (char_length("subject") BETWEEN 1 AND 120 AND "subject" !~ '[\r\n]'));
-- Notificação (Central RN04): count = grupos distintos do payload, uma lista.
ALTER TABLE "notifications" ADD CONSTRAINT "chk_notifications_count" CHECK ("count" >= 1);
ALTER TABLE "notifications" ADD CONSTRAINT "chk_notifications_payload"
  CHECK (jsonb_typeof("payload") = 'array');

-- Índices da spec.
-- Uma não lida por grupo de eventos (Central RN04): o INSERT … ON CONFLICT da
-- notify_rsvp usa este índice. O contador do sino (RN06) e a retenção (RN08).
CREATE UNIQUE INDEX "uq_notifications_user_id_group_key_unread"
  ON "notifications" ("user_id", "group_key") WHERE "read_at" IS NULL;
CREATE INDEX "idx_notifications_user_id_wedding_id_unread"
  ON "notifications" ("user_id", "wedding_id") WHERE "read_at" IS NULL;
CREATE INDEX "idx_notifications_read_at"
  ON "notifications" ("read_at") WHERE "read_at" IS NOT NULL;
-- Lista de músicas (Música, Mudanças no modelo de dados).
CREATE INDEX "idx_guests_wedding_id_song_suggested_at"
  ON "guests" ("wedding_id", "song_suggested_at")
  WHERE "song_suggestion" IS NOT NULL AND "deleted_at" IS NULL;

-- GRANT UPDATE por coluna (T3). paid_through fica sem grant: só a F3 escreve
-- (decisão 217(4)). status e published_at já tinham.
GRANT UPDATE ("end_date", "publication_source", "published_by_user_id", "rsvp_deadline",
              "song_question_enabled", "song_question_text")
  ON "weddings" TO kore_app;
GRANT UPDATE ("version", "sent_at", "first_viewed_at", "last_channel", "save_the_date_sent_at",
              "last_reminder_at", "last_response_actor", "last_signed_by_guest_id",
              "last_response_user_id")
  ON "parties" TO kore_app;
GRANT UPDATE ("song_suggestion", "song_suggested_at") ON "guests" TO kore_app;

-- RLS por vínculo (decisão 153) nas tabelas novas do casamento. O histórico
-- (rsvp_submissions, guest_responses) e os envios (party_deliveries) são só
-- inserção: sem UPDATE nem DELETE pela API; só o backoffice apaga (expurgo).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rsvp_submissions', 'guest_responses', 'message_templates',
                           'party_deliveries'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (wedding_id IN (SELECT active_wedding_ids()) '
      'AND (current_wedding_id() IS NULL OR wedding_id = current_wedding_id()))',
      t || '_member_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT WITH CHECK (wedding_id IN (SELECT active_wedding_ids()) '
      'AND (current_wedding_id() IS NULL OR wedding_id = current_wedding_id()))',
      t || '_member_insert', t);
  END LOOP;
END
$$;
REVOKE UPDATE, DELETE ON "rsvp_submissions", "guest_responses", "party_deliveries" FROM kore_app;

-- Mensagem pronta: editar e Restaurar a mensagem padrão (apaga a linha; sem
-- linha, vale o padrão, Envios RN06).
CREATE POLICY "message_templates_member_update" ON "message_templates" FOR UPDATE
  USING ("wedding_id" IN (SELECT active_wedding_ids())
         AND (current_wedding_id() IS NULL OR "wedding_id" = current_wedding_id()))
  WITH CHECK ("wedding_id" IN (SELECT active_wedding_ids()));
CREATE POLICY "message_templates_member_delete" ON "message_templates" FOR DELETE
  USING ("wedding_id" IN (SELECT active_wedding_ids())
         AND (current_wedding_id() IS NULL OR "wedding_id" = current_wedding_id()));
REVOKE UPDATE ON "message_templates" FROM kore_app;
GRANT UPDATE ("subject", "body", "updated_by_user_id", "updated_at") ON "message_templates" TO kore_app;

-- Notificação (Central RN09): só da própria pessoa e só enquanto ela tem
-- vínculo com o casamento. A API só marca como lida; a inclusão é da
-- notify_rsvp (SECURITY DEFINER, no PR do RSVP) e do backoffice; a retenção
-- (RN08) e o expurgo apagam pelo backoffice.
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY "notifications_own_select" ON "notifications" FOR SELECT
  USING ("user_id" = current_user_id() AND "wedding_id" IN (SELECT active_wedding_ids())
         AND (current_wedding_id() IS NULL OR "wedding_id" = current_wedding_id()));
CREATE POLICY "notifications_own_update" ON "notifications" FOR UPDATE
  USING ("user_id" = current_user_id() AND "wedding_id" IN (SELECT active_wedding_ids())
         AND (current_wedding_id() IS NULL OR "wedding_id" = current_wedding_id()))
  WITH CHECK ("user_id" = current_user_id());
REVOKE INSERT, UPDATE, DELETE ON "notifications" FROM kore_app;
GRANT UPDATE ("read_at") ON "notifications" TO kore_app;

-- Preferência (Central RN07 e RN09): cada pessoa, só as suas, dos casamentos
-- em que tem vínculo. A linha de weddingId nulo (geral da cerimonialista) e o
-- índice parcial dela ficam para a F6 (revisão técnica R7-6).
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_preferences" FORCE ROW LEVEL SECURITY;
CREATE POLICY "notification_preferences_own_select" ON "notification_preferences" FOR SELECT
  USING ("user_id" = current_user_id() AND "wedding_id" IN (SELECT active_wedding_ids()));
CREATE POLICY "notification_preferences_own_insert" ON "notification_preferences" FOR INSERT
  WITH CHECK ("user_id" = current_user_id() AND "wedding_id" IN (SELECT active_wedding_ids()));
CREATE POLICY "notification_preferences_own_update" ON "notification_preferences" FOR UPDATE
  USING ("user_id" = current_user_id() AND "wedding_id" IN (SELECT active_wedding_ids()))
  WITH CHECK ("user_id" = current_user_id() AND "wedding_id" IN (SELECT active_wedding_ids()));
REVOKE UPDATE, DELETE ON "notification_preferences" FROM kore_app;
GRANT UPDATE ("email", "push", "updated_at") ON "notification_preferences" TO kore_app;

-- Estado do e-mail (E-mail e push RN02): só o worker (backoffice) lê e grava.
ALTER TABLE "notification_email_states" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_email_states" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "notification_email_states" FROM kore_app;

-- Assinatura de push (E-mail e push RN07 e RN08): da própria pessoa. A API
-- grava, troca a sessão e apaga (desligar neste aparelho; Sair); o
-- last_success_at é do worker.
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "push_subscriptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "push_subscriptions_own_select" ON "push_subscriptions" FOR SELECT
  USING ("user_id" = current_user_id());
CREATE POLICY "push_subscriptions_own_insert" ON "push_subscriptions" FOR INSERT
  WITH CHECK ("user_id" = current_user_id());
CREATE POLICY "push_subscriptions_own_update" ON "push_subscriptions" FOR UPDATE
  USING ("user_id" = current_user_id()) WITH CHECK ("user_id" = current_user_id());
CREATE POLICY "push_subscriptions_own_delete" ON "push_subscriptions" FOR DELETE
  USING ("user_id" = current_user_id());
REVOKE UPDATE ON "push_subscriptions" FROM kore_app;
GRANT UPDATE ("session_id", "p256dh", "auth", "user_agent", "updated_at")
  ON "push_subscriptions" TO kore_app;

-- A coluna nova parties.version tem o nome de um parâmetro da site_party_view:
-- numa função SQL, a coluna vence o parâmetro, e "p.link_version = version"
-- passaria a comparar com p.version, aceitando o cookie de um link regenerado
-- (ADR-36, item 2). Os parâmetros passam a ser qualificados pelo nome da função.
CREATE OR REPLACE FUNCTION site_party_view(wedding uuid, party uuid, version integer) RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT jsonb_build_object(
      'partyName', p.name,
      'contactWhatsapp', w.contact_whatsapp,
      'contactEmail', w.contact_email,
      'venues', (
        SELECT coalesce(c.content -> 'venues', '[]'::jsonb)
        FROM public.sections s
        JOIN public.section_contents c ON c.section_id = s.id AND c.locale = 'pt-BR'
        WHERE s.wedding_id = w.id AND s.type = 'ceremony'
      )
    )
    FROM public.parties p
    JOIN public.weddings w ON w.id = p.wedding_id
    WHERE p.id = site_party_view.party AND p.wedding_id = site_party_view.wedding
      AND p.deleted_at IS NULL
      AND p.link_version = site_party_view.version
      AND w.status IN ('published', 'post_event', 'grace')
  $$;
