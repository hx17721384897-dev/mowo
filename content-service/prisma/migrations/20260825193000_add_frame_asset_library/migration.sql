ALTER TABLE "animation_assets"
  ALTER COLUMN "owner_user_id" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "source_channel" VARCHAR(30) NOT NULL DEFAULT 'WEB_CUSTOM',
  ADD COLUMN IF NOT EXISTS "usage_type" VARCHAR(30) NOT NULL DEFAULT 'PRIVATE_CUSTOM',
  ADD COLUMN IF NOT EXISTS "rights_holder_type" VARCHAR(30) NOT NULL DEFAULT 'USER',
  ADD COLUMN IF NOT EXISTS "rights_holder_name" VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "rights_holder_contact" VARCHAR(200),
  ADD COLUMN IF NOT EXISTS "authorization_status" VARCHAR(30) NOT NULL DEFAULT 'PRIVATE_ONLY',
  ADD COLUMN IF NOT EXISTS "internal_notes" TEXT,
  ADD COLUMN IF NOT EXISTS "created_by_staff_id" TEXT,
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP(3);

DO $$ BEGIN
  ALTER TABLE "animation_assets" ADD CONSTRAINT "animation_assets_created_by_staff_id_fkey"
    FOREIGN KEY ("created_by_staff_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "animation_assets_source_channel_usage_type_status_idx"
  ON "animation_assets"("source_channel", "usage_type", "status");
CREATE INDEX IF NOT EXISTS "animation_assets_created_by_staff_id_created_at_idx"
  ON "animation_assets"("created_by_staff_id", "created_at");

CREATE TABLE IF NOT EXISTS "animation_tags" (
  "id" TEXT NOT NULL,
  "name" VARCHAR(40) NOT NULL,
  "color" VARCHAR(20),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "animation_tags_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "animation_tags_name_key" ON "animation_tags"("name");

CREATE TABLE IF NOT EXISTS "animation_asset_tags" (
  "asset_id" TEXT NOT NULL,
  "tag_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "animation_asset_tags_pkey" PRIMARY KEY ("asset_id", "tag_id"),
  CONSTRAINT "animation_asset_tags_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "animation_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "animation_asset_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "animation_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "animation_asset_tags_tag_id_asset_id_idx" ON "animation_asset_tags"("tag_id", "asset_id");

ALTER TABLE "collab_works"
  ADD COLUMN IF NOT EXISTS "animation_asset_id" TEXT,
  ADD COLUMN IF NOT EXISTS "animation_version_id" TEXT;

DO $$ BEGIN
  ALTER TABLE "collab_works" ADD CONSTRAINT "collab_works_animation_asset_id_fkey"
    FOREIGN KEY ("animation_asset_id") REFERENCES "animation_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "collab_works" ADD CONSTRAINT "collab_works_animation_version_id_fkey"
    FOREIGN KEY ("animation_version_id") REFERENCES "animation_asset_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "collab_works_animation_asset_id_idx" ON "collab_works"("animation_asset_id");
CREATE INDEX IF NOT EXISTS "collab_works_animation_version_id_idx" ON "collab_works"("animation_version_id");
