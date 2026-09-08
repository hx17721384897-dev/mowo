-- 账户 v1 曾通过 db push 落入运行库，缺少可重放迁移。
-- 本迁移仅补 B1 登录、设置、会话和审计依赖的新增结构；
-- 不在此处放宽 users.phone 等需单独业务确认的既有约束。

DO $$ BEGIN
  CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'LIMITED', 'SUSPENDED', 'PENDING_DELETE', 'DELETED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SmsPurpose" AS ENUM ('LOGIN', 'REGISTER', 'RESET_PASSWORD', 'BIND_PHONE', 'DEACTIVATE', 'STEP_UP_WITHDRAW', 'STEP_UP_CHANGE_PAYOUT', 'STEP_UP_CHANGE_PASSWORD');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ActionType" AS ENUM ('WITHDRAW', 'CHANGE_PAYOUT_ACCOUNT', 'CHANGE_PASSWORD', 'CHANGE_PHONE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "wechat_openid" TEXT,
  ADD COLUMN IF NOT EXISTS "wechat_unionid" TEXT,
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "delete_reason" VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "privacy_agreed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "privacy_policy_version" VARCHAR(20);

-- 短信注册没有密码；现行 auth-v1 会创建 password_hash 为 NULL 的账号。
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "users_wechat_openid_key" ON "users"("wechat_openid");
CREATE UNIQUE INDEX IF NOT EXISTS "users_wechat_unionid_key" ON "users"("wechat_unionid");

ALTER TABLE "user_profiles"
  ADD COLUMN IF NOT EXISTS "login_fail_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "login_locked_until" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_login_ip" VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "last_login_at_v1" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "nickname_updated_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "notify_interaction" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "notify_order" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "notify_system" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "notify_promo" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "profile_visibility" VARCHAR(20) NOT NULL DEFAULT 'public';

CREATE TABLE IF NOT EXISTS "sms_codes" (
  "id" TEXT NOT NULL,
  "user_id" TEXT,
  "phone" VARCHAR(20) NOT NULL,
  "code" VARCHAR(10) NOT NULL,
  "purpose" "SmsPurpose" NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sms_codes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "sms_codes_phone_created_at_idx" ON "sms_codes"("phone", "created_at");
CREATE INDEX IF NOT EXISTS "sms_codes_phone_purpose_created_at_idx" ON "sms_codes"("phone", "purpose", "created_at");

CREATE TABLE IF NOT EXISTS "sms_global_counters" (
  "id" TEXT NOT NULL,
  "hour_key" VARCHAR(20) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sms_global_counters_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "sms_global_counters_hour_key_key" ON "sms_global_counters"("hour_key");
CREATE INDEX IF NOT EXISTS "sms_global_counters_hour_key_idx" ON "sms_global_counters"("hour_key");

CREATE TABLE IF NOT EXISTS "action_tokens" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "action" "ActionType" NOT NULL,
  "target_id" TEXT,
  "ua_hash" TEXT,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "action_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "action_tokens_token_key" ON "action_tokens"("token");
CREATE INDEX IF NOT EXISTS "action_tokens_user_id_action_created_at_idx" ON "action_tokens"("user_id", "action", "created_at");

CREATE TABLE IF NOT EXISTS "refresh_tokens" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "session_id" TEXT,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "refresh_tokens_token_key" ON "refresh_tokens"("token");
CREATE INDEX IF NOT EXISTS "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

CREATE TABLE IF NOT EXISTS "token_blacklist" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "reason" VARCHAR(100),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "token_blacklist_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "token_blacklist_user_id_expires_at_idx" ON "token_blacklist"("user_id", "expires_at");

CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" TEXT NOT NULL,
  "user_id" TEXT,
  "action" VARCHAR(100) NOT NULL,
  "target_id" TEXT,
  "detail" JSONB,
  "ip" VARCHAR(50),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

DO $$ BEGIN
  ALTER TABLE "sms_codes" ADD CONSTRAINT "sms_codes_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "action_tokens" ADD CONSTRAINT "action_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
