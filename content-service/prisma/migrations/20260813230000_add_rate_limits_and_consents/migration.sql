CREATE TABLE IF NOT EXISTS "rate_limit_buckets" (
  "id" TEXT NOT NULL,
  "scope" VARCHAR(60) NOT NULL,
  "subject_hash" VARCHAR(64) NOT NULL,
  "target_hash" VARCHAR(64) NOT NULL DEFAULT '',
  "window_key" VARCHAR(40) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "rate_limit_buckets_scope_subject_hash_target_hash_window_key_key"
  ON "rate_limit_buckets"("scope", "subject_hash", "target_hash", "window_key");
CREATE INDEX IF NOT EXISTS "rate_limit_buckets_scope_subject_hash_window_key_idx"
  ON "rate_limit_buckets"("scope", "subject_hash", "window_key");
CREATE INDEX IF NOT EXISTS "rate_limit_buckets_expires_at_idx" ON "rate_limit_buckets"("expires_at");

CREATE TABLE IF NOT EXISTS "consent_records" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "type" VARCHAR(30) NOT NULL,
  "version" VARCHAR(30) NOT NULL,
  "scene" VARCHAR(30) NOT NULL,
  "ip" VARCHAR(50),
  "user_agent" VARCHAR(500),
  "agreed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "consent_records_user_id_type_agreed_at_idx" ON "consent_records"("user_id", "type", "agreed_at");
CREATE INDEX IF NOT EXISTS "consent_records_type_version_idx" ON "consent_records"("type", "version");
