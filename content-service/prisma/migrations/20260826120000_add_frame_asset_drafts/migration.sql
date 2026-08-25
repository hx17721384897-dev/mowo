CREATE TABLE IF NOT EXISTS "frame_asset_drafts" (
  "id" TEXT NOT NULL,
  "draft_no" VARCHAR(32) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  "created_by_staff_id" TEXT NOT NULL,
  "last_edited_by_staff_id" TEXT NOT NULL,
  "source_keys" JSONB NOT NULL,
  "source_type" VARCHAR(20) NOT NULL,
  "source_metadata" JSONB,
  "editor_data" JSONB,
  "title" VARCHAR(200) NOT NULL DEFAULT '未命名动画',
  "target_ratio" VARCHAR(20) NOT NULL DEFAULT '1:1',
  "source_channel" VARCHAR(30) NOT NULL DEFAULT 'INTERNAL_CREATED',
  "usage_type" VARCHAR(30) NOT NULL DEFAULT 'INTERNAL_TEST',
  "rights_holder_type" VARCHAR(30) NOT NULL DEFAULT 'COMPANY',
  "rights_holder_name" VARCHAR(120),
  "rights_holder_contact" VARCHAR(200),
  "authorization_status" VARCHAR(30) NOT NULL DEFAULT 'PRIVATE_ONLY',
  "owner_user_id" TEXT,
  "tags" JSONB,
  "internal_notes" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "animation_asset_id" TEXT,
  "published_at" TIMESTAMP(3),
  "abandoned_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "frame_asset_drafts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "frame_asset_drafts_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "frame_asset_drafts_last_edited_by_staff_id_fkey" FOREIGN KEY ("last_edited_by_staff_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "frame_asset_drafts_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "frame_asset_drafts_animation_asset_id_fkey" FOREIGN KEY ("animation_asset_id") REFERENCES "animation_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "frame_asset_drafts_draft_no_key" ON "frame_asset_drafts"("draft_no");
CREATE UNIQUE INDEX IF NOT EXISTS "frame_asset_drafts_animation_asset_id_key" ON "frame_asset_drafts"("animation_asset_id");
CREATE INDEX IF NOT EXISTS "frame_asset_drafts_status_updated_at_idx" ON "frame_asset_drafts"("status", "updated_at");
CREATE INDEX IF NOT EXISTS "frame_asset_drafts_created_by_staff_id_status_idx" ON "frame_asset_drafts"("created_by_staff_id", "status");
CREATE INDEX IF NOT EXISTS "frame_asset_drafts_owner_user_id_idx" ON "frame_asset_drafts"("owner_user_id");
