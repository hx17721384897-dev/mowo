ALTER TABLE "customization_requests"
  ADD COLUMN IF NOT EXISTS "assigned_staff_id" TEXT,
  ADD COLUMN IF NOT EXISTS "claimed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lock_expires_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "staff_draft_data" JSONB,
  ADD COLUMN IF NOT EXISTS "staff_draft_updated_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "customization_frame_selections" (
  "id" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "selected_frame_keys" JSONB NOT NULL,
  "editor_data" JSONB,
  "staff_message" TEXT,
  "internal_note" TEXT,
  "status" VARCHAR(30) NOT NULL DEFAULT 'SUBMITTED',
  "created_by_staff_id" TEXT,
  "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "responded_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customization_frame_selections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customization_frame_selections_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "customization_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customization_frame_selections_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

DO $$ BEGIN
  ALTER TABLE "customization_requests" ADD CONSTRAINT "customization_requests_assigned_staff_id_fkey"
    FOREIGN KEY ("assigned_staff_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "customization_frame_selections_request_id_version_key" ON "customization_frame_selections"("request_id", "version");
CREATE INDEX IF NOT EXISTS "customization_frame_selections_request_id_status_created_at_idx" ON "customization_frame_selections"("request_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "customization_frame_selections_created_by_staff_id_created_at_idx" ON "customization_frame_selections"("created_by_staff_id", "created_at");
CREATE INDEX IF NOT EXISTS "customization_requests_assigned_staff_id_status_idx" ON "customization_requests"("assigned_staff_id", "status");
