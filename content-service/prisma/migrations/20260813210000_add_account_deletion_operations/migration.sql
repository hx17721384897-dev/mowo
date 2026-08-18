ALTER TABLE "account_deletion_requests"
  ADD COLUMN IF NOT EXISTS "first_failed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "manual_review_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "paused_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "paused_by" TEXT,
  ADD COLUMN IF NOT EXISTS "pause_reason" VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "resumed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_manual_action_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_manual_action_by" TEXT;
