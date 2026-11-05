-- CreateEnum
CREATE TYPE "login_origin" AS ENUM ('invite', 'referral', 'couple_signup', 'planner_signup', 'none');

-- AlterTable
-- Sessões abertas antes desta migration (só em ambiente de desenvolvimento)
-- vieram do login por e-mail; depois, o valor é sempre informado.
ALTER TABLE "sessions" ADD COLUMN "auth_method" "auth_provider" NOT NULL DEFAULT 'email';
ALTER TABLE "sessions" ALTER COLUMN "auth_method" DROP DEFAULT;

-- CreateTable
CREATE TABLE "login_challenges" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "email" CITEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMPTZ(3),
    "invalidated_at" TIMESTAMPTZ(3),
    "origin" "login_origin" NOT NULL DEFAULT 'none',
    "origin_ref" TEXT,
    "request_ip" INET,

    CONSTRAINT "login_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_login_challenges_token_hash" ON "login_challenges"("token_hash");

-- CreateIndex
CREATE INDEX "idx_login_challenges_email_created_at" ON "login_challenges"("email", "created_at");

-- CreateIndex
CREATE INDEX "idx_login_challenges_expires_at" ON "login_challenges"("expires_at");
