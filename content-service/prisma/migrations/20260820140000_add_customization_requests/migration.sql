CREATE TABLE IF NOT EXISTS "customization_requests" (
  "id" TEXT NOT NULL,
  "request_no" VARCHAR(32),
  "user_id" TEXT NOT NULL,
  "mode" VARCHAR(20) NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "client_draft_key" VARCHAR(80),
  "custom_product_id" TEXT,
  "machine_model_id" TEXT,
  "desired_sku_id" TEXT,
  "source_keys" JSONB NOT NULL,
  "selected_frame_keys" JSONB,
  "screening_data" JSONB,
  "editor_data" JSONB,
  "user_note" TEXT,
  "creator_declared" BOOLEAN NOT NULL DEFAULT false,
  "copyright_confirmed" BOOLEAN NOT NULL DEFAULT false,
  "cooperation_interested" BOOLEAN NOT NULL DEFAULT false,
  "submitted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customization_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customization_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "customization_request_events" (
  "id" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "actor_user_id" TEXT,
  "actor_type" VARCHAR(20) NOT NULL,
  "event_type" VARCHAR(40) NOT NULL,
  "from_status" VARCHAR(30),
  "to_status" VARCHAR(30),
  "public_message" TEXT,
  "internal_note" TEXT,
  "detail" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customization_request_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customization_request_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "customization_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customization_request_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "customization_requests_request_no_key" ON "customization_requests"("request_no");
CREATE UNIQUE INDEX IF NOT EXISTS "customization_requests_client_draft_key_key" ON "customization_requests"("client_draft_key");
CREATE INDEX IF NOT EXISTS "customization_requests_user_id_status_created_at_idx" ON "customization_requests"("user_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "customization_requests_status_submitted_at_idx" ON "customization_requests"("status", "submitted_at");
CREATE INDEX IF NOT EXISTS "customization_requests_machine_model_id_idx" ON "customization_requests"("machine_model_id");
CREATE INDEX IF NOT EXISTS "customization_request_events_request_id_created_at_idx" ON "customization_request_events"("request_id", "created_at");
CREATE INDEX IF NOT EXISTS "customization_request_events_actor_user_id_created_at_idx" ON "customization_request_events"("actor_user_id", "created_at");

-- db execute 可能重复运行；确保已创建的本地表也与 Prisma @updatedAt 约定一致。
ALTER TABLE IF EXISTS "customization_requests" ALTER COLUMN "updated_at" DROP DEFAULT;
