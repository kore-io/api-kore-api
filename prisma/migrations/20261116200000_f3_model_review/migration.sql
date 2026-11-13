-- Revisão do PR 75-modelo (Crivo, 12/11/2026). Numa migration própria porque a
-- f3_model já está aplicada nos bancos locais e no kore_test compartilhado.

-- Toda FK tem índice (Modelo de Dados, Índices e performance): o ON DELETE SET
-- NULL da FK nova varreria a maior tabela do banco.
CREATE INDEX "idx_application_logs_support_session_id" ON "application_logs"("support_session_id");

-- O pagamento do evento (Retenção RN03): o expurgo acha os eventos do casamento
-- para anonimizar o payload. Sem FK, como o log; preenchido no processamento.
ALTER TABLE "gateway_events" ADD COLUMN "payment_id" UUID;
CREATE INDEX "idx_gateway_events_payment_id" ON "gateway_events"("payment_id");

-- O pendente que o app cria não traz nada do gateway nem de estado posterior
-- (RN03, passo 1; RN20): esses campos são do passo 3 e do worker.
DROP POLICY "payments_owner_insert" ON "payments";
CREATE POLICY "payments_owner_insert" ON "payments" FOR INSERT
  WITH CHECK ("wedding_id" IN (SELECT owned_wedding_ids())
              AND (current_wedding_id() IS NULL OR "wedding_id" = current_wedding_id())
              AND "status" = 'pending' AND "created_by_user_id" = current_user_id()
              AND "gateway_payment_id" IS NULL AND "pix_copy_paste" IS NULL AND "due_at" IS NULL
              AND "card_last4" IS NULL AND "gateway_charged_cents" IS NULL
              AND "gateway_fee_cents" IS NULL AND "net_cents" IS NULL
              AND "paid_at" IS NULL AND "applied_at" IS NULL AND "applied_by_admin_at" IS NULL
              AND "failure_reason" IS NULL AND "canceled_at" IS NULL
              AND "refund_origin" IS NULL AND "refunded_at" IS NULL
              AND "disputed_at" IS NULL AND "dispute_deadline" IS NULL);

-- Defesa em profundidade nos inserts antigos: o app não cria casamento já com
-- ciclo de vida, bloqueio, exclusão ou pago (o paid_through é só da F3,
-- decisão 217(4)), nem indicador já com CPF ou CNPJ (Repasse RN02: grava por
-- função própria). Restritivas: somam-se às permissivas que já existem.
CREATE POLICY "weddings_f3_insert_guard" ON "weddings" AS RESTRICTIVE FOR INSERT
  WITH CHECK ("paid_through" IS NULL AND "grace_until" IS NULL AND "expired_at" IS NULL
              AND "purge_at" IS NULL AND "blocked_at" IS NULL AND "blocked_by_user_id" IS NULL
              AND "deletion_scheduled_for" IS NULL AND "deletion_requested_by_user_id" IS NULL);
CREATE POLICY "referrers_tax_id_insert_guard" ON "referrers" AS RESTRICTIVE FOR INSERT
  WITH CHECK ("tax_id_type" IS NULL AND "tax_id_encrypted" IS NULL AND "tax_id_hash" IS NULL
              AND "tax_id_hash_version" IS NULL);
