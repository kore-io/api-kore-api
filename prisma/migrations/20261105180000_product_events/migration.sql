-- CreateEnum
CREATE TYPE "product_event_name" AS ENUM ('conta_criada', 'cerim_link_gerado', 'casal_aceitou');

-- CreateTable
CREATE TABLE "product_events" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" "product_event_name" NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "wedding_ref" TEXT,
    "props" JSONB,

    CONSTRAINT "product_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_product_events_occurred_at" ON "product_events"("occurred_at");

-- CreateIndex
CREATE INDEX "idx_product_events_name_occurred_at" ON "product_events"("name", "occurred_at");

-- SQL manual (ADR do Prisma) -------------------------------------------------

-- Só inserção para a API; o backoffice lê e a rotina de retenção apaga.
REVOKE ALL ON "product_events" FROM kore_app, kore_backoffice;
GRANT INSERT ON "product_events" TO kore_app;
GRANT SELECT, INSERT, DELETE ON "product_events" TO kore_backoffice;
