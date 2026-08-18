CREATE TABLE IF NOT EXISTS "account_deletion_requests" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'REQUESTED',
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "scheduled_at" TIMESTAMP(3) NOT NULL,
  "processing_started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "blockers" JSONB,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_retry_at" TIMESTAMP(3),
  "last_error" VARCHAR(1000),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_deletion_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "account_deletion_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "account_deletion_requests_user_id_key" ON "account_deletion_requests"("user_id");
CREATE INDEX IF NOT EXISTS "account_deletion_requests_status_scheduled_at_idx" ON "account_deletion_requests"("status", "scheduled_at");
CREATE INDEX IF NOT EXISTS "account_deletion_requests_status_next_retry_at_idx" ON "account_deletion_requests"("status", "next_retry_at");
