-- CreateEnum
CREATE TYPE "platform_role" AS ENUM ('none', 'admin', 'support');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('active', 'blocked');

-- CreateEnum
CREATE TYPE "auth_provider" AS ENUM ('google', 'email');

-- CreateEnum
CREATE TYPE "profile_kind" AS ENUM ('couple', 'planner', 'seller');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "email" CITEXT NOT NULL,
    "name" TEXT,
    "avatar_key" TEXT,
    "platform_role" "platform_role" NOT NULL DEFAULT 'none',
    "status" "user_status" NOT NULL DEFAULT 'active',
    "last_login_at" TIMESTAMPTZ(3),
    "terms_version" TEXT,
    "terms_accepted_at" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_identities" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID NOT NULL,
    "provider" "auth_provider" NOT NULL,
    "provider_subject" TEXT NOT NULL,

    CONSTRAINT "auth_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "authenticated_at" TIMESTAMPTZ(3) NOT NULL,
    "active_profile" "profile_kind",
    "support_session_id" UUID,
    "user_agent" TEXT,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_users_email" ON "users"("email");

-- CreateIndex
CREATE INDEX "idx_auth_identities_user_id" ON "auth_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_auth_identities_provider_provider_subject" ON "auth_identities"("provider", "provider_subject");

-- CreateIndex
CREATE UNIQUE INDEX "uq_sessions_token_hash" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "idx_sessions_user_id" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "idx_sessions_expires_at" ON "sessions"("expires_at");

-- AddForeignKey
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
