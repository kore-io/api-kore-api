-- CreateEnum
CREATE TYPE "payment_kind" AS ENUM ('publication', 'extension');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('pending', 'paid', 'failed', 'canceled', 'refund_requested', 'refunded', 'disputed');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('pix', 'card');

-- CreateEnum
CREATE TYPE "payment_gateway_name" AS ENUM ('local', 'asaas');

-- CreateEnum
CREATE TYPE "refund_origin" AS ENUM ('couple', 'admin', 'automatic', 'chargeback', 'manual');

-- CreateEnum
CREATE TYPE "commission_status" AS ENUM ('pending', 'available', 'paid', 'reversed', 'blocked', 'held');

-- CreateEnum
CREATE TYPE "commission_block_reason" AS ENUM ('self_referral', 'referrer_blocked', 'admin');

-- CreateEnum
CREATE TYPE "commission_adjustment_reason" AS ENUM ('refund', 'chargeback', 'manual');

-- CreateEnum
CREATE TYPE "payout_status" AS ENUM ('requested', 'held', 'processing', 'paid', 'rejected');

-- CreateEnum
CREATE TYPE "payout_hold_reason" AS ENUM ('refund', 'pix_key_change', 'referrer_blocked', 'dispute', 'commission_blocked');

-- CreateEnum
CREATE TYPE "tax_id_type" AS ENUM ('cpf', 'cnpj');

-- CreateEnum
CREATE TYPE "pix_key_type" AS ENUM ('cpf', 'cnpj', 'email', 'phone', 'random');

-- CreateEnum
CREATE TYPE "pix_key_status" AS ENUM ('pending_confirmation', 'pending_activation', 'active', 'replaced', 'canceled');

-- CreateEnum
CREATE TYPE "alert_type" AS ENUM ('pix_key_churn', 'login_abuse', 'photo_flood', 'webhook_failure', 'orphan_payment', 'gateway_amount_mismatch', 'refund_failed', 'payment_disputed', 'dispute_lost', 'repeated_refund', 'payout_failed', 'purge_failed', 'access_email_changed', 'manual_adjustment');

-- CreateEnum
CREATE TYPE "alert_status" AS ENUM ('open', 'resolved');

-- CreateEnum
CREATE TYPE "support_session_end_reason" AS ENUM ('exit', 'idle', 'max_duration', 'logout');

-- CreateEnum
CREATE TYPE "billing_notice" AS ENUM ('end_date_in_7_days', 'grace_day_1', 'grace_day_5', 'expired');



-- AlterTable
ALTER TABLE "referrers" ADD COLUMN     "tax_id_encrypted" TEXT,
ADD COLUMN     "tax_id_hash" TEXT,
ADD COLUMN     "tax_id_hash_version" SMALLINT,
ADD COLUMN     "tax_id_type" "tax_id_type";

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "staff_domain" TEXT;

-- AlterTable
ALTER TABLE "weddings" ADD COLUMN     "blocked_at" TIMESTAMPTZ(3),
ADD COLUMN     "blocked_by_user_id" UUID,
ADD COLUMN     "deletion_requested_by_user_id" UUID,
ADD COLUMN     "deletion_scheduled_for" DATE,
ADD COLUMN     "expired_at" DATE,
ADD COLUMN     "grace_until" DATE,
ADD COLUMN     "purge_at" DATE;

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "short_code" SERIAL NOT NULL,
    "wedding_id" UUID NOT NULL,
    "kind" "payment_kind" NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'pending',
    "method" "payment_method" NOT NULL,
    "installments" SMALLINT NOT NULL DEFAULT 1,
    "price_version" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "months_covered" SMALLINT NOT NULL,
    "activation_list_cents" INTEGER NOT NULL,
    "monthly_list_cents" INTEGER NOT NULL,
    "cap_discount_cents" INTEGER NOT NULL DEFAULT 0,
    "referral_discount_cents" INTEGER NOT NULL DEFAULT 0,
    "pix_discount_cents" INTEGER NOT NULL DEFAULT 0,
    "installment_interest_cents" INTEGER NOT NULL DEFAULT 0,
    "amount_cents" INTEGER NOT NULL,
    "gateway_charged_cents" INTEGER,
    "gateway_fee_cents" INTEGER,
    "net_cents" INTEGER,
    "gateway" "payment_gateway_name" NOT NULL,
    "external_reference" TEXT NOT NULL,
    "gateway_payment_id" TEXT,
    "pix_copy_paste" TEXT,
    "card_last4" CHAR(4),
    "payer_name" TEXT NOT NULL,
    "payer_tax_id_hash" TEXT NOT NULL,
    "payer_tax_id_hash_version" SMALLINT NOT NULL,
    "payer_tax_id_last4" CHAR(4) NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "request_hash" TEXT NOT NULL,
    "created_by_user_id" UUID,
    "replaces_payment_id" UUID,
    "due_at" TIMESTAMPTZ(3),
    "paid_at" TIMESTAMPTZ(3),
    "applied_at" TIMESTAMPTZ(3),
    "applied_by_admin_at" TIMESTAMPTZ(3),
    "failure_reason" TEXT,
    "canceled_at" TIMESTAMPTZ(3),
    "previous_end_date" DATE,
    "previous_paid_through" DATE,
    "refund_origin" "refund_origin",
    "refund_requested_at" TIMESTAMPTZ(3),
    "refund_requested_by_user_id" UUID,
    "refund_reason" TEXT,
    "refund_attempts" SMALLINT NOT NULL DEFAULT 0,
    "refund_last_error" TEXT,
    "refund_failed_at" TIMESTAMPTZ(3),
    "refunded_outside_gateway" BOOLEAN NOT NULL DEFAULT false,
    "refund_receipt_key" TEXT,
    "refunded_at" TIMESTAMPTZ(3),
    "disputed_at" TIMESTAMPTZ(3),
    "dispute_deadline" DATE,
    "dispute_resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gateway_events" (
    "id" UUID NOT NULL,
    "gateway" "payment_gateway_name" NOT NULL,
    "gateway_event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),
    "result" TEXT,

    CONSTRAINT "gateway_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gateway_customers" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "wedding_id" UUID NOT NULL,
    "gateway" "payment_gateway_name" NOT NULL,
    "payer_tax_id_hash" TEXT NOT NULL,
    "gateway_customer_id" TEXT NOT NULL,

    CONSTRAINT "gateway_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commissions" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "referrer_id" UUID NOT NULL,
    "wedding_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "base_amount_cents" INTEGER NOT NULL,
    "rate_percent" SMALLINT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "status" "commission_status" NOT NULL,
    "block_reason" "commission_block_reason",
    "available_at" TIMESTAMPTZ(3) NOT NULL,
    "reversed_at" TIMESTAMPTZ(3),
    "paid_at" TIMESTAMPTZ(3),
    "payout_id" UUID,

    CONSTRAINT "commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_adjustments" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "referrer_id" UUID NOT NULL,
    "commission_id" UUID,
    "amount_cents" INTEGER NOT NULL,
    "reason" "commission_adjustment_reason" NOT NULL,
    "note" TEXT,
    "created_by_user_id" UUID,
    "payout_id" UUID,

    CONSTRAINT "commission_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "referrer_id" UUID NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "status" "payout_status" NOT NULL DEFAULT 'requested',
    "hold_reason" "payout_hold_reason",
    "pix_key_id" UUID NOT NULL,
    "pix_key_masked" TEXT NOT NULL,
    "external_ref" TEXT NOT NULL,
    "gateway_transfer_id" TEXT,
    "idempotency_key" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL,
    "processing_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "paid_at" TIMESTAMPTZ(3),
    "paid_by_user_id" UUID,
    "receipt_key" TEXT,
    "rejected_at" TIMESTAMPTZ(3),
    "reject_reason" TEXT,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrer_pix_keys" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "referrer_id" UUID NOT NULL,
    "key_type" "pix_key_type" NOT NULL,
    "key_encrypted" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "key_masked" TEXT NOT NULL,
    "status" "pix_key_status" NOT NULL DEFAULT 'pending_confirmation',
    "confirm_token_hash" TEXT,
    "confirm_expires_at" TIMESTAMPTZ(3),
    "confirmed_at" TIMESTAMPTZ(3),
    "active_from" TIMESTAMPTZ(3),
    "replaced_at" TIMESTAMPTZ(3),
    "canceled_at" TIMESTAMPTZ(3),

    CONSTRAINT "referrer_pix_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "alert_type" NOT NULL,
    "status" "alert_status" NOT NULL DEFAULT 'open',
    "wedding_id" UUID,
    "user_id" UUID,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "data" JSONB,
    "resolved_by_user_id" UUID,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_sessions" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "admin_user_id" UUID NOT NULL,
    "wedding_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),
    "end_reason" "support_session_end_reason",

    CONSTRAINT "support_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courtesy_extensions" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "wedding_id" UUID NOT NULL,
    "admin_user_id" UUID,
    "months" SMALLINT NOT NULL,
    "reason" TEXT NOT NULL,
    "previous_end_date" DATE NOT NULL,
    "previous_paid_through" DATE,
    "new_end_date" DATE NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,

    CONSTRAINT "courtesy_extensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_notice_logs" (
    "id" UUID NOT NULL,
    "wedding_id" UUID NOT NULL,
    "notice" "billing_notice" NOT NULL,
    "end_date" DATE NOT NULL,
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_notice_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_payments_short_code" ON "payments"("short_code");

-- CreateIndex
CREATE UNIQUE INDEX "uq_payments_external_reference" ON "payments"("external_reference");

-- CreateIndex
CREATE UNIQUE INDEX "uq_payments_gateway_payment_id" ON "payments"("gateway_payment_id");

-- CreateIndex
CREATE INDEX "idx_payments_wedding_id_created_at" ON "payments"("wedding_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_payments_created_by_user_id" ON "payments"("created_by_user_id");

-- CreateIndex
CREATE INDEX "idx_payments_refund_requested_by_user_id" ON "payments"("refund_requested_by_user_id");

-- CreateIndex
CREATE INDEX "idx_payments_replaces_payment_id" ON "payments"("replaces_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_payments_wedding_id_idempotency_key" ON "payments"("wedding_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "uq_gateway_events_gateway_gateway_event_id" ON "gateway_events"("gateway", "gateway_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_gateway_customers_wedding_id_gateway_payer_tax_id_hash" ON "gateway_customers"("wedding_id", "gateway", "payer_tax_id_hash");

-- CreateIndex
CREATE UNIQUE INDEX "uq_commissions_payment_id" ON "commissions"("payment_id");

-- CreateIndex
CREATE INDEX "idx_commissions_referrer_id_status_available_at" ON "commissions"("referrer_id", "status", "available_at");

-- CreateIndex
CREATE INDEX "idx_commissions_referrer_id_created_at" ON "commissions"("referrer_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_commissions_wedding_id" ON "commissions"("wedding_id");

-- CreateIndex
CREATE INDEX "idx_commissions_payout_id" ON "commissions"("payout_id");

-- CreateIndex
CREATE INDEX "idx_commission_adjustments_referrer_id_created_at" ON "commission_adjustments"("referrer_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_commission_adjustments_commission_id" ON "commission_adjustments"("commission_id");

-- CreateIndex
CREATE INDEX "idx_commission_adjustments_created_by_user_id" ON "commission_adjustments"("created_by_user_id");

-- CreateIndex
CREATE INDEX "idx_commission_adjustments_payout_id" ON "commission_adjustments"("payout_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_payouts_external_ref" ON "payouts"("external_ref");

-- CreateIndex
CREATE INDEX "idx_payouts_referrer_id_requested_at" ON "payouts"("referrer_id", "requested_at" DESC);

-- CreateIndex
CREATE INDEX "idx_payouts_status_requested_at" ON "payouts"("status", "requested_at");

-- CreateIndex
CREATE INDEX "idx_payouts_pix_key_id" ON "payouts"("pix_key_id");

-- CreateIndex
CREATE INDEX "idx_payouts_paid_by_user_id" ON "payouts"("paid_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_payouts_referrer_id_idempotency_key" ON "payouts"("referrer_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "idx_referrer_pix_keys_referrer_id_created_at" ON "referrer_pix_keys"("referrer_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_alerts_wedding_id" ON "alerts"("wedding_id");

-- CreateIndex
CREATE INDEX "idx_support_sessions_admin_user_id_started_at" ON "support_sessions"("admin_user_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "idx_support_sessions_wedding_id" ON "support_sessions"("wedding_id");

-- CreateIndex
CREATE INDEX "idx_courtesy_extensions_wedding_id_created_at" ON "courtesy_extensions"("wedding_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_courtesy_extensions_admin_user_id" ON "courtesy_extensions"("admin_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_billing_notice_logs_wedding_id_notice_end_date" ON "billing_notice_logs"("wedding_id", "notice", "end_date");

-- CreateIndex
CREATE UNIQUE INDEX "uq_referrers_tax_id_hash" ON "referrers"("tax_id_hash");

-- CreateIndex
CREATE INDEX "idx_sessions_support_session_id" ON "sessions"("support_session_id");

-- CreateIndex
CREATE INDEX "idx_weddings_blocked_by_user_id" ON "weddings"("blocked_by_user_id");

-- CreateIndex
CREATE INDEX "idx_weddings_deletion_requested_by_user_id" ON "weddings"("deletion_requested_by_user_id");

-- AddForeignKey
ALTER TABLE "application_logs" ADD CONSTRAINT "application_logs_support_session_id_fkey" FOREIGN KEY ("support_session_id") REFERENCES "support_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_support_session_id_fkey" FOREIGN KEY ("support_session_id") REFERENCES "support_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weddings" ADD CONSTRAINT "weddings_blocked_by_user_id_fkey" FOREIGN KEY ("blocked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weddings" ADD CONSTRAINT "weddings_deletion_requested_by_user_id_fkey" FOREIGN KEY ("deletion_requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_wedding_id_fkey" FOREIGN KEY ("wedding_id") REFERENCES "weddings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_refund_requested_by_user_id_fkey" FOREIGN KEY ("refund_requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_replaces_payment_id_fkey" FOREIGN KEY ("replaces_payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateway_customers" ADD CONSTRAINT "gateway_customers_wedding_id_fkey" FOREIGN KEY ("wedding_id") REFERENCES "weddings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "referrers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_wedding_id_fkey" FOREIGN KEY ("wedding_id") REFERENCES "weddings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_adjustments" ADD CONSTRAINT "commission_adjustments_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "referrers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_adjustments" ADD CONSTRAINT "commission_adjustments_commission_id_fkey" FOREIGN KEY ("commission_id") REFERENCES "commissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_adjustments" ADD CONSTRAINT "commission_adjustments_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_adjustments" ADD CONSTRAINT "commission_adjustments_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "referrers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_pix_key_id_fkey" FOREIGN KEY ("pix_key_id") REFERENCES "referrer_pix_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_paid_by_user_id_fkey" FOREIGN KEY ("paid_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrer_pix_keys" ADD CONSTRAINT "referrer_pix_keys_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "referrers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_sessions" ADD CONSTRAINT "support_sessions_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_sessions" ADD CONSTRAINT "support_sessions_wedding_id_fkey" FOREIGN KEY ("wedding_id") REFERENCES "weddings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courtesy_extensions" ADD CONSTRAINT "courtesy_extensions_wedding_id_fkey" FOREIGN KEY ("wedding_id") REFERENCES "weddings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courtesy_extensions" ADD CONSTRAINT "courtesy_extensions_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_notice_logs" ADD CONSTRAINT "billing_notice_logs_wedding_id_fkey" FOREIGN KEY ("wedding_id") REFERENCES "weddings"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- SQL manual (specs da F3; decisões 230 e 231; revisão técnica G3: quem lê e
-- quem grava cada tabela) ----------------------------------------------------

-- Cobrança (Publicar e pagar RN10 a RN12 e RN20) ------------------------------

-- A referência que vai ao gateway é o próprio id (RN03, passo 1; B2-1).
ALTER TABLE "payments" ADD CONSTRAINT "chk_payments_external_reference"
  CHECK ("external_reference" = "id"::text);
-- Linhas em centavos inteiros e o total = tabela − descontos + juros (RN12; B2-19).
ALTER TABLE "payments" ADD CONSTRAINT "chk_payments_amounts"
  CHECK ("activation_list_cents" >= 0 AND "monthly_list_cents" > 0
         AND "cap_discount_cents" >= 0 AND "referral_discount_cents" >= 0
         AND "pix_discount_cents" >= 0 AND "installment_interest_cents" >= 0
         AND "amount_cents" > 0
         AND "amount_cents" = "activation_list_cents" + "monthly_list_cents" * "months_covered"
                              - "cap_discount_cents" - "referral_discount_cents"
                              - "pix_discount_cents" + "installment_interest_cents");
ALTER TABLE "payments" ADD CONSTRAINT "chk_payments_gateway_amounts"
  CHECK (("gateway_charged_cents" IS NULL OR "gateway_charged_cents" > 0)
         AND ("gateway_fee_cents" IS NULL OR "gateway_fee_cents" >= 0));
-- A extensão não tem ativação, teto nem desconto de indicação (Preço RN01; D5).
ALTER TABLE "payments" ADD CONSTRAINT "chk_payments_extension_lines"
  CHECK ("kind" = 'publication'
         OR ("activation_list_cents" = 0 AND "cap_discount_cents" = 0 AND "referral_discount_cents" = 0));
-- Pix à vista, sem juros; cartão de 1 a 12x, sem desconto do Pix (Preço RN01).
ALTER TABLE "payments" ADD CONSTRAINT "chk_payments_method"
  CHECK (("method" = 'pix' AND "installments" = 1 AND "installment_interest_cents" = 0)
         OR ("method" = 'card' AND "installments" BETWEEN 1 AND 12 AND "pix_discount_cents" = 0));
ALTER TABLE "payments" ADD CONSTRAINT "chk_payments_period"
  CHECK ("months_covered" >= 1 AND "period_end" > "period_start");
ALTER TABLE "payments" ADD CONSTRAINT "chk_payments_payer"
  CHECK (char_length(btrim("payer_name")) BETWEEN 1 AND 200
         AND "payer_tax_id_last4" ~ '^[0-9]{4}$' AND "payer_tax_id_hash_version" >= 1);
-- Só o dinheiro recebido é aplicado (B2-2); o pendente não tem confirmação.
ALTER TABLE "payments" ADD CONSTRAINT "chk_payments_applied_at"
  CHECK ("applied_at" IS NULL
         OR ("paid_at" IS NOT NULL AND "status" IN ('paid', 'refund_requested', 'refunded', 'disputed')));
ALTER TABLE "payments" ADD CONSTRAINT "chk_payments_pending"
  CHECK ("status" <> 'pending' OR ("paid_at" IS NULL AND "refund_requested_at" IS NULL));
ALTER TABLE "payments" ADD CONSTRAINT "chk_payments_refund"
  CHECK ("refund_attempts" >= 0
         AND ("refund_reason" IS NULL OR char_length("refund_reason") <= 500)
         AND ("status" NOT IN ('refund_requested', 'refunded') OR "refund_origin" IS NOT NULL)
         AND ("status" <> 'refunded' OR "refunded_at" IS NOT NULL));
-- A volta da data no estorno da extensão (B3-5): só na extensão.
ALTER TABLE "payments" ADD CONSTRAINT "chk_payments_previous_end_date"
  CHECK ("kind" = 'extension' OR ("previous_end_date" IS NULL AND "previous_paid_through" IS NULL));

-- Os índices únicos de dinheiro (RN07; decisão 231, B2-2): um pendente por
-- tipo; uma publicação aplicada; uma extensão aplicada por início de período.
CREATE UNIQUE INDEX "uq_payments_wedding_id_kind_pending"
  ON "payments" ("wedding_id", "kind") WHERE "status" = 'pending';
CREATE UNIQUE INDEX "uq_payments_wedding_id_publication_applied"
  ON "payments" ("wedding_id")
  WHERE "kind" = 'publication' AND "status" IN ('paid', 'refund_requested', 'disputed')
        AND "applied_at" IS NOT NULL;
CREATE UNIQUE INDEX "uq_payments_wedding_id_period_start_extension_applied"
  ON "payments" ("wedding_id", "period_start")
  WHERE "kind" = 'extension' AND "status" IN ('paid', 'refund_requested', 'disputed')
        AND "applied_at" IS NOT NULL;
-- Reconciliação (RN11): os pendentes de 10 em 10 minutos; a diária pelos outros.
CREATE INDEX "idx_payments_pending_created_at"
  ON "payments" ("created_at") WHERE "status" = 'pending';
CREATE INDEX "idx_payments_status_updated_at"
  ON "payments" ("status", "updated_at") WHERE "status" IN ('paid', 'refund_requested', 'disputed');
-- Backoffice › Cobrança (lista por data).
CREATE INDEX "idx_payments_created_at" ON "payments" ("created_at" DESC);

-- RLS e GRANT (RN20): o kore_app lê só nos casamentos de que é dono e insere só
-- o pendente, criado pela própria pessoa (RN03, passo 1). Estado, valores e
-- campos do gateway mudam no kore_backoffice (worker) ou por função SECURITY
-- DEFINER (o passo 3 da RN03 e a desistência, nos PRs seguintes).
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "payments_owner_select" ON "payments" FOR SELECT
  USING ("wedding_id" IN (SELECT owned_wedding_ids())
         AND (current_wedding_id() IS NULL OR "wedding_id" = current_wedding_id()));
CREATE POLICY "payments_owner_insert" ON "payments" FOR INSERT
  WITH CHECK ("wedding_id" IN (SELECT owned_wedding_ids())
              AND (current_wedding_id() IS NULL OR "wedding_id" = current_wedding_id())
              AND "status" = 'pending' AND "created_by_user_id" = current_user_id()
              AND "gateway_payment_id" IS NULL AND "paid_at" IS NULL AND "applied_at" IS NULL
              AND "gateway_charged_cents" IS NULL AND "refund_origin" IS NULL);
REVOKE UPDATE, DELETE ON "payments" FROM kore_app;

-- Webhook, cliente do gateway, alerta, Ver como o casal, cortesia e avisos de
-- saída do ar: só o kore_backoffice (G3; RN20).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['gateway_events', 'gateway_customers', 'alerts', 'support_sessions',
                           'courtesy_extensions', 'billing_notice_logs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %I FROM kore_app', t);
  END LOOP;
END
$$;
-- A cortesia é só inserção (decisão 73); o log do webhook não se apaga.
REVOKE UPDATE, DELETE ON "courtesy_extensions" FROM kore_backoffice;
REVOKE DELETE ON "gateway_events" FROM kore_backoffice;

-- "Aguardando pagamento" para a colaboradora e a indicadora (RN06; G3;
-- decisão 29): só o booleano, sem valores, e só para quem tem vínculo com o
-- casamento ou o indicou. Fora disso, nulo.
GRANT SELECT ON "payments" TO kore_rls;
CREATE FUNCTION wedding_awaiting_payment(wedding uuid) RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT CASE
      WHEN wedding_awaiting_payment.wedding IN (SELECT public.active_wedding_ids())
        OR wedding_awaiting_payment.wedding IN (SELECT public.referred_wedding_ids())
      THEN EXISTS (
        SELECT 1 FROM public.payments p
        JOIN public.weddings w ON w.id = p.wedding_id
        WHERE p.wedding_id = wedding_awaiting_payment.wedding AND p.kind = 'publication'
          AND p.status = 'pending' AND w.status = 'draft')
    END
  $$;
ALTER FUNCTION wedding_awaiting_payment(uuid) OWNER TO kore_rls;
REVOKE ALL ON FUNCTION wedding_awaiting_payment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wedding_awaiting_payment(uuid) TO kore_app, kore_backoffice;
GRANT EXECUTE ON FUNCTION referred_wedding_ids() TO kore_rls;

-- Comissão, ajuste e repasse (Comissões RN10; Repasse, Mudanças no modelo) ----

ALTER TABLE "commissions" ADD CONSTRAINT "chk_commissions_amounts"
  CHECK ("base_amount_cents" > 0 AND "rate_percent" BETWEEN 0 AND 100 AND "amount_cents" > 0);
ALTER TABLE "commissions" ADD CONSTRAINT "chk_commissions_block_reason"
  CHECK (("status" = 'blocked') = ("block_reason" IS NOT NULL));
ALTER TABLE "commissions" ADD CONSTRAINT "chk_commissions_reversed_at"
  CHECK (("status" = 'reversed') = ("reversed_at" IS NOT NULL));
-- Liberação diária (Comissões RN02).
CREATE INDEX "idx_commissions_available_at_pending"
  ON "commissions" ("available_at") WHERE "status" = 'pending';

ALTER TABLE "commission_adjustments" ADD CONSTRAINT "chk_commission_adjustments_amount"
  CHECK ("amount_cents" <> 0);
-- O ajuste manual do Admin não tem comissão; o do estorno tem (Backoffice - cobrança).
ALTER TABLE "commission_adjustments" ADD CONSTRAINT "chk_commission_adjustments_commission"
  CHECK (("reason" = 'manual') = ("commission_id" IS NULL));
ALTER TABLE "commission_adjustments" ADD CONSTRAINT "chk_commission_adjustments_note"
  CHECK ("note" IS NULL OR char_length("note") <= 500);

ALTER TABLE "payouts" ADD CONSTRAINT "chk_payouts_amount" CHECK ("amount_cents" >= 5000);
ALTER TABLE "payouts" ADD CONSTRAINT "chk_payouts_hold_reason"
  CHECK (("status" = 'held') = ("hold_reason" IS NOT NULL));
ALTER TABLE "payouts" ADD CONSTRAINT "chk_payouts_paid"
  CHECK (("status" = 'paid') = ("paid_at" IS NOT NULL));
ALTER TABLE "payouts" ADD CONSTRAINT "chk_payouts_rejected"
  CHECK (("status" = 'rejected') = ("rejected_at" IS NOT NULL AND "reject_reason" IS NOT NULL));
-- Um repasse aberto por indicador (Repasse RN04; B7-3).
CREATE UNIQUE INDEX "uq_payouts_referrer_id_open"
  ON "payouts" ("referrer_id") WHERE "status" IN ('requested', 'held', 'processing');

-- Chave Pix: uma ativa e uma troca em andamento por indicador (Repasse RN03).
CREATE UNIQUE INDEX "uq_referrer_pix_keys_referrer_id_active"
  ON "referrer_pix_keys" ("referrer_id") WHERE "status" = 'active';
CREATE UNIQUE INDEX "uq_referrer_pix_keys_referrer_id_pending"
  ON "referrer_pix_keys" ("referrer_id") WHERE "status" IN ('pending_confirmation', 'pending_activation');
ALTER TABLE "referrer_pix_keys" ADD CONSTRAINT "chk_referrer_pix_keys_pending_activation"
  CHECK ("status" <> 'pending_activation' OR "active_from" IS NOT NULL);

-- RLS por referrerId, sem weddingId (Comissões RN10; G3). O kore_app só lê o
-- que é do próprio indicador ativo; quem grava é o kore_backoffice e as
-- funções SECURITY DEFINER do pedido de repasse e da chave Pix (PR do repasse).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['commissions', 'commission_adjustments', 'payouts',
                           'referrer_pix_keys'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (referrer_id = current_referrer_id())',
                   t || '_own_select', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON %I FROM kore_app', t);
  END LOOP;
END
$$;
-- A chave nunca sai inteira para o app, nem o hash do token (Repasse RN03).
REVOKE SELECT ON "referrer_pix_keys" FROM kore_app;
GRANT SELECT ("id", "created_at", "updated_at", "referrer_id", "key_type", "key_masked", "status",
              "confirm_expires_at", "confirmed_at", "active_from", "replaced_at", "canceled_at")
  ON "referrer_pix_keys" TO kore_app;

-- O CPF ou CNPJ do indicador (Repasse RN02): a leitura de referrers é livre
-- (o destaque do link de indicação), então o cifrado e o HMAC ficam fora do
-- SELECT do kore_app; o tipo e a versão podem sair.
REVOKE SELECT ON "referrers" FROM kore_app;
GRANT SELECT ("id", "created_at", "updated_at", "user_id", "kind", "referral_code", "rate_percent",
              "referral_discount_enabled", "status", "created_by_admin_user_id", "deactivated_at",
              "tax_id_type", "tax_id_hash_version")
  ON "referrers" TO kore_app;

-- Alerta (Backoffice - acesso RN12; B9-7) -------------------------------------
CREATE UNIQUE INDEX "uq_alerts_type_entity_open"
  ON "alerts" ("type", "entity_type", "entity_id") WHERE "status" = 'open';
CREATE INDEX "idx_alerts_created_at_open" ON "alerts" ("created_at" DESC) WHERE "status" = 'open';
CREATE INDEX "idx_alerts_resolved_at" ON "alerts" ("resolved_at" DESC) WHERE "status" = 'resolved';
ALTER TABLE "alerts" ADD CONSTRAINT "chk_alerts_resolved"
  CHECK (("status" = 'resolved') = ("resolved_at" IS NOT NULL));

-- Ver como o casal (Backoffice - acesso RN08): motivo de 10 ou mais.
ALTER TABLE "support_sessions" ADD CONSTRAINT "chk_support_sessions_reason"
  CHECK (char_length(btrim("reason")) BETWEEN 10 AND 500);
ALTER TABLE "support_sessions" ADD CONSTRAINT "chk_support_sessions_ended"
  CHECK (("ended_at" IS NULL) = ("end_reason" IS NULL));
CREATE INDEX "idx_support_sessions_open"
  ON "support_sessions" ("last_seen_at") WHERE "ended_at" IS NULL;

-- Cortesia do Admin (decisão 73): meses positivos, motivo de 10 ou mais.
ALTER TABLE "courtesy_extensions" ADD CONSTRAINT "chk_courtesy_extensions_values"
  CHECK ("months" >= 1 AND char_length(btrim("reason")) BETWEEN 10 AND 500
         AND "new_end_date" > "previous_end_date" AND "period_end" > "period_start");

-- Casamento: ciclo de vida, bloqueio e exclusão agendada ----------------------

-- Índices parciais das rotinas (Data de saída do ar, Mudanças no modelo de
-- dados; Retenção). O do paidThrough do Modelo vira endDate (decisão 230, D11).
CREATE INDEX "idx_weddings_end_date_live"
  ON "weddings" ("end_date") WHERE "status" IN ('published', 'post_event');
CREATE INDEX "idx_weddings_grace_until_grace"
  ON "weddings" ("grace_until") WHERE "status" = 'grace';
CREATE INDEX "idx_weddings_purge_at_expired"
  ON "weddings" ("purge_at") WHERE "status" = 'expired';
CREATE INDEX "idx_weddings_deletion_scheduled_for"
  ON "weddings" ("deletion_scheduled_for") WHERE "deletion_scheduled_for" IS NOT NULL;
CREATE INDEX "idx_weddings_blocked_at"
  ON "weddings" ("blocked_at") WHERE "blocked_at" IS NOT NULL;

ALTER TABLE "weddings" ADD CONSTRAINT "chk_weddings_blocked_by"
  CHECK ("blocked_by_user_id" IS NULL OR "blocked_at" IS NOT NULL);
ALTER TABLE "weddings" ADD CONSTRAINT "chk_weddings_deletion_requested_by"
  CHECK ("deletion_requested_by_user_id" IS NULL OR "deletion_scheduled_for" IS NOT NULL);
ALTER TABLE "weddings" ADD CONSTRAINT "chk_weddings_lifecycle_dates"
  CHECK (("grace_until" IS NULL OR "end_date" IS NULL OR "grace_until" > "end_date")
         AND ("expired_at" IS NULL OR "grace_until" IS NULL OR "expired_at" > "grace_until")
         AND ("purge_at" IS NULL OR "expired_at" IS NULL OR "purge_at" > "expired_at"));
-- Lápide (decisão 180; Retenção RN03): as colunas da F3 zeram no expurgo.
ALTER TABLE "weddings" ADD CONSTRAINT "chk_weddings_f3_tombstone"
  CHECK ("status" <> 'purged'
         OR ("end_date" IS NULL AND "publication_source" IS NULL AND "paid_through" IS NULL
             AND "grace_until" IS NULL AND "expired_at" IS NULL AND "purge_at" IS NULL
             AND "purge_notice_sent_at" IS NULL AND "blocked_at" IS NULL
             AND "blocked_by_user_id" IS NULL AND "deletion_scheduled_for" IS NULL
             AND "deletion_requested_by_user_id" IS NULL));
-- Fuso do casamento (Retenção RN04): só os do mapa de UF (wedding-signup.ts);
-- o nulo antigo continua valendo.
ALTER TABLE "weddings" ADD CONSTRAINT "chk_weddings_timezone"
  CHECK ("timezone" IS NULL OR "timezone" IN (
    'America/Araguaina', 'America/Bahia', 'America/Belem', 'America/Boa_Vista',
    'America/Campo_Grande', 'America/Cuiaba', 'America/Fortaleza', 'America/Maceio',
    'America/Manaus', 'America/Porto_Velho', 'America/Recife', 'America/Rio_Branco',
    'America/Sao_Paulo'));
-- As colunas novas do casamento não têm GRANT de UPDATE ao kore_app: o ciclo
-- de vida e o bloqueio são do worker e do Backoffice; a exclusão agendada,
-- de função SECURITY DEFINER (PR do expurgo).

-- Central (Publicar e pagar RN13; Comissões RN09; Backoffice - acesso RN07;
-- revisão técnica G6): uma policy por tipo novo. O billing é só dos donos do
-- casamento; o commission e o referrer_reassigned são do indicador que os
-- recebe (ele pode não ter vínculo com o casamento, e o antigo deixa de
-- indicá-lo), então valem sempre para a própria pessoa.
DROP POLICY "notifications_own_select" ON "notifications";
DROP POLICY "notifications_own_update" ON "notifications";
CREATE POLICY "notifications_own_select" ON "notifications" FOR SELECT
  USING ("user_id" = current_user_id()
         AND (current_wedding_id() IS NULL OR "wedding_id" = current_wedding_id())
         AND (("type" = 'rsvp' AND "wedding_id" IN (SELECT active_wedding_ids()))
              OR ("type" = 'wedding_published'
                  AND ("wedding_id" IN (SELECT active_wedding_ids())
                       OR "wedding_id" IN (SELECT referred_wedding_ids())))
              OR ("type" = 'billing' AND "wedding_id" IN (SELECT owned_wedding_ids()))
              OR "type" IN ('membership_removed', 'commission', 'referrer_reassigned')));
CREATE POLICY "notifications_own_update" ON "notifications" FOR UPDATE
  USING ("user_id" = current_user_id()
         AND (current_wedding_id() IS NULL OR "wedding_id" = current_wedding_id())
         AND (("type" = 'rsvp' AND "wedding_id" IN (SELECT active_wedding_ids()))
              OR ("type" = 'wedding_published'
                  AND ("wedding_id" IN (SELECT active_wedding_ids())
                       OR "wedding_id" IN (SELECT referred_wedding_ids())))
              OR ("type" = 'billing' AND "wedding_id" IN (SELECT owned_wedding_ids()))
              OR "type" IN ('membership_removed', 'commission', 'referrer_reassigned')))
  WITH CHECK ("user_id" = current_user_id());
