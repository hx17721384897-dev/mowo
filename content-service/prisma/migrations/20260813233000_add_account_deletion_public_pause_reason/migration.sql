ALTER TABLE "account_deletion_requests"
  ADD COLUMN IF NOT EXISTS "pause_user_message" VARCHAR(300);
