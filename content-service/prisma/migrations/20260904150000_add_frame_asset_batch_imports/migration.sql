CREATE TABLE "frame_asset_import_batches" (
  "id" TEXT NOT NULL,
  "batch_no" VARCHAR(32) NOT NULL,
  "batch_type" VARCHAR(20) NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'UPLOADING',
  "defaults" JSONB,
  "total_items" INTEGER NOT NULL DEFAULT 0,
  "total_files" INTEGER NOT NULL DEFAULT 0,
  "total_bytes" BIGINT NOT NULL DEFAULT 0,
  "imported_items" INTEGER NOT NULL DEFAULT 0,
  "failed_items" INTEGER NOT NULL DEFAULT 0,
  "skipped_items" INTEGER NOT NULL DEFAULT 0,
  "created_by_staff_id" TEXT NOT NULL,
  "preflighted_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "frame_asset_import_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "frame_asset_import_items" (
  "id" TEXT NOT NULL,
  "batch_id" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "folder_name" VARCHAR(255) NOT NULL,
  "relative_path" VARCHAR(500) NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'UPLOADING',
  "title" VARCHAR(200) NOT NULL,
  "source_channel" VARCHAR(30) NOT NULL,
  "usage_type" VARCHAR(30) NOT NULL,
  "rights_holder_type" VARCHAR(30) NOT NULL,
  "rights_holder_name" VARCHAR(120),
  "rights_holder_contact" VARCHAR(200),
  "authorization_status" VARCHAR(30) NOT NULL,
  "owner_phone" VARCHAR(20),
  "tags" JSONB,
  "internal_notes" TEXT,
  "file_manifest" JSONB NOT NULL,
  "frame_count" INTEGER NOT NULL,
  "fingerprint" VARCHAR(64),
  "duplicate_asset_id" TEXT,
  "allow_duplicate" BOOLEAN NOT NULL DEFAULT false,
  "issues" JSONB,
  "animation_asset_id" TEXT,
  "imported_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "frame_asset_import_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "frame_asset_import_batches_batch_no_key" ON "frame_asset_import_batches"("batch_no");
CREATE INDEX "frame_asset_import_batches_status_updated_at_idx" ON "frame_asset_import_batches"("status", "updated_at");
CREATE INDEX "frame_asset_import_batches_created_by_staff_id_created_at_idx" ON "frame_asset_import_batches"("created_by_staff_id", "created_at");
CREATE UNIQUE INDEX "frame_asset_import_items_animation_asset_id_key" ON "frame_asset_import_items"("animation_asset_id");
CREATE UNIQUE INDEX "frame_asset_import_items_batch_id_folder_name_key" ON "frame_asset_import_items"("batch_id", "folder_name");
CREATE INDEX "frame_asset_import_items_batch_id_status_position_idx" ON "frame_asset_import_items"("batch_id", "status", "position");
CREATE INDEX "frame_asset_import_items_fingerprint_idx" ON "frame_asset_import_items"("fingerprint");
ALTER TABLE "frame_asset_import_batches" ADD CONSTRAINT "frame_asset_import_batches_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "frame_asset_import_items" ADD CONSTRAINT "frame_asset_import_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "frame_asset_import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "frame_asset_import_items" ADD CONSTRAINT "frame_asset_import_items_animation_asset_id_fkey" FOREIGN KEY ("animation_asset_id") REFERENCES "animation_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
