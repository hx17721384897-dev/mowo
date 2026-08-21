CREATE TABLE IF NOT EXISTS "animation_assets" (
  "id" TEXT NOT NULL,
  "asset_no" VARCHAR(32) NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "title" VARCHAR(200) NOT NULL DEFAULT '未命名动画',
  "source_type" VARCHAR(30) NOT NULL,
  "asset_type" VARCHAR(20) NOT NULL DEFAULT 'PRIVATE',
  "status" VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  "collab_status" VARCHAR(30) NOT NULL DEFAULT 'NONE',
  "current_version_no" INTEGER NOT NULL DEFAULT 0,
  "front_deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "animation_assets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "animation_assets_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "animation_asset_versions" (
  "id" TEXT NOT NULL,
  "asset_id" TEXT NOT NULL,
  "version_no" INTEGER NOT NULL,
  "source_key" VARCHAR(120) NOT NULL,
  "source_type" VARCHAR(30) NOT NULL,
  "source_request_id" TEXT,
  "source_frame_selection_id" TEXT,
  "source_custom_product_id" TEXT,
  "created_by_user_id" TEXT,
  "frame_keys" JSONB NOT NULL,
  "base_frame_count" INTEGER NOT NULL,
  "editor_data" JSONB,
  "manifest_hash" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "animation_asset_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "animation_asset_versions_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "animation_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "animation_asset_versions_source_request_id_fkey" FOREIGN KEY ("source_request_id") REFERENCES "customization_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "animation_asset_versions_source_frame_selection_id_fkey" FOREIGN KEY ("source_frame_selection_id") REFERENCES "customization_frame_selections"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "animation_asset_versions_source_custom_product_id_fkey" FOREIGN KEY ("source_custom_product_id") REFERENCES "custom_products"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "animation_asset_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

ALTER TABLE "custom_products"
  ADD COLUMN IF NOT EXISTS "animation_asset_id" TEXT,
  ADD COLUMN IF NOT EXISTS "animation_version_id" TEXT;

ALTER TABLE "customization_requests"
  ADD COLUMN IF NOT EXISTS "animation_asset_id" TEXT,
  ADD COLUMN IF NOT EXISTS "accepted_animation_version_id" TEXT;

DO $$ BEGIN
  ALTER TABLE "custom_products" ADD CONSTRAINT "custom_products_animation_asset_id_fkey"
    FOREIGN KEY ("animation_asset_id") REFERENCES "animation_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "custom_products" ADD CONSTRAINT "custom_products_animation_version_id_fkey"
    FOREIGN KEY ("animation_version_id") REFERENCES "animation_asset_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "customization_requests" ADD CONSTRAINT "customization_requests_animation_asset_id_fkey"
    FOREIGN KEY ("animation_asset_id") REFERENCES "animation_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "customization_requests" ADD CONSTRAINT "customization_requests_accepted_animation_version_id_fkey"
    FOREIGN KEY ("accepted_animation_version_id") REFERENCES "animation_asset_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "animation_assets_asset_no_key" ON "animation_assets"("asset_no");
CREATE INDEX IF NOT EXISTS "animation_assets_owner_user_id_status_updated_at_idx" ON "animation_assets"("owner_user_id", "status", "updated_at");
CREATE INDEX IF NOT EXISTS "animation_assets_asset_type_collab_status_idx" ON "animation_assets"("asset_type", "collab_status");
CREATE UNIQUE INDEX IF NOT EXISTS "animation_asset_versions_source_key_key" ON "animation_asset_versions"("source_key");
CREATE UNIQUE INDEX IF NOT EXISTS "animation_asset_versions_source_frame_selection_id_key" ON "animation_asset_versions"("source_frame_selection_id");
CREATE UNIQUE INDEX IF NOT EXISTS "animation_asset_versions_asset_id_version_no_key" ON "animation_asset_versions"("asset_id", "version_no");
CREATE INDEX IF NOT EXISTS "animation_asset_versions_asset_id_created_at_idx" ON "animation_asset_versions"("asset_id", "created_at");
CREATE INDEX IF NOT EXISTS "animation_asset_versions_source_request_id_idx" ON "animation_asset_versions"("source_request_id");
CREATE INDEX IF NOT EXISTS "animation_asset_versions_source_custom_product_id_idx" ON "animation_asset_versions"("source_custom_product_id");
CREATE INDEX IF NOT EXISTS "custom_products_animation_asset_id_idx" ON "custom_products"("animation_asset_id");
CREATE INDEX IF NOT EXISTS "custom_products_animation_version_id_idx" ON "custom_products"("animation_version_id");
CREATE INDEX IF NOT EXISTS "customization_requests_animation_asset_id_idx" ON "customization_requests"("animation_asset_id");
CREATE INDEX IF NOT EXISTS "customization_requests_accepted_animation_version_id_idx" ON "customization_requests"("accepted_animation_version_id");
