CREATE TABLE IF NOT EXISTS "private_files" (
  "id" TEXT NOT NULL,
  "owner_user_id" TEXT,
  "anonymous_owner_hash" VARCHAR(64),
  "purpose" VARCHAR(40) NOT NULL,
  "storage_provider" VARCHAR(20) NOT NULL DEFAULT 'local',
  "object_key" VARCHAR(500) NOT NULL,
  "original_name" VARCHAR(255) NOT NULL,
  "declared_mime_type" VARCHAR(150) NOT NULL,
  "detected_mime_type" VARCHAR(150),
  "declared_size_bytes" INTEGER NOT NULL,
  "size_bytes" INTEGER,
  "sha256" VARCHAR(64),
  "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "upload_token_hash" VARCHAR(64),
  "upload_expires_at" TIMESTAMP(3),
  "linked_resource_type" VARCHAR(40),
  "linked_resource_id" VARCHAR(100),
  "uploaded_at" TIMESTAMP(3),
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "private_files_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "private_files_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "private_files_object_key_key" ON "private_files"("object_key");
CREATE INDEX IF NOT EXISTS "private_files_owner_user_id_created_at_idx" ON "private_files"("owner_user_id", "created_at");
CREATE INDEX IF NOT EXISTS "private_files_purpose_status_idx" ON "private_files"("purpose", "status");
CREATE INDEX IF NOT EXISTS "private_files_linked_resource_type_linked_resource_id_idx" ON "private_files"("linked_resource_type", "linked_resource_id");
