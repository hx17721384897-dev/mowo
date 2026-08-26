ALTER TABLE "print_cut_groups"
  ADD COLUMN "paper_type" VARCHAR(40) NOT NULL DEFAULT '普通打印纸',
  ADD COLUMN "orientation" VARCHAR(20) NOT NULL DEFAULT 'LANDSCAPE',
  ADD COLUMN "frame_width_mm" INTEGER,
  ADD COLUMN "frame_height_mm" INTEGER,
  ADD COLUMN "render_dpi" INTEGER NOT NULL DEFAULT 600,
  ADD COLUMN "separator_microns" INTEGER NOT NULL DEFAULT 460;

CREATE TABLE "print_template_versions" (
  "id" TEXT NOT NULL, "group_id" TEXT NOT NULL, "version_no" INTEGER NOT NULL,
  "original_name" VARCHAR(255) NOT NULL, "object_key" VARCHAR(500) NOT NULL,
  "sha256" VARCHAR(64) NOT NULL, "size_bytes" INTEGER NOT NULL, "cell_count" INTEGER NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "print_template_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "print_template_versions_object_key_key" ON "print_template_versions"("object_key");
CREATE UNIQUE INDEX "print_template_versions_group_id_version_no_key" ON "print_template_versions"("group_id", "version_no");
CREATE INDEX "print_template_versions_group_id_status_version_no_idx" ON "print_template_versions"("group_id", "status", "version_no");
ALTER TABLE "print_template_versions" ADD CONSTRAINT "print_template_versions_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "print_cut_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "production_frame_renders" (
  "id" TEXT NOT NULL, "animation_version_id" TEXT NOT NULL, "size" VARCHAR(20) NOT NULL,
  "width_px" INTEGER NOT NULL, "height_px" INTEGER NOT NULL, "dpi" INTEGER NOT NULL,
  "separator_microns" INTEGER NOT NULL, "marker_enabled" BOOLEAN NOT NULL DEFAULT true,
  "processor_version" VARCHAR(30) NOT NULL, "frame_keys" JSONB NOT NULL,
  "manifest_hash" VARCHAR(64) NOT NULL, "status" VARCHAR(20) NOT NULL DEFAULT 'READY',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "production_frame_renders_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "production_frame_renders_spec_key" ON "production_frame_renders"("animation_version_id", "size", "dpi", "separator_microns", "marker_enabled", "processor_version");
CREATE INDEX "production_frame_renders_animation_version_id_created_at_idx" ON "production_frame_renders"("animation_version_id", "created_at");
ALTER TABLE "production_frame_renders" ADD CONSTRAINT "production_frame_renders_animation_version_id_fkey" FOREIGN KEY ("animation_version_id") REFERENCES "animation_asset_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "production_print_files" (
  "id" TEXT NOT NULL, "asset_id" TEXT NOT NULL, "animation_version_id" TEXT NOT NULL,
  "render_id" TEXT NOT NULL, "template_version_id" TEXT NOT NULL, "target_frame_count" INTEGER NOT NULL,
  "file_version_no" INTEGER NOT NULL, "display_name" VARCHAR(255) NOT NULL,
  "object_key" VARCHAR(500) NOT NULL, "manifest_hash" VARCHAR(64) NOT NULL,
  "source_type" VARCHAR(20) NOT NULL DEFAULT 'MANUAL', "production_batch_id" VARCHAR(40),
  "status" VARCHAR(20) NOT NULL DEFAULT 'READY', "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "production_print_files_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "production_print_files_object_key_key" ON "production_print_files"("object_key");
CREATE UNIQUE INDEX "production_print_files_spec_version_key" ON "production_print_files"("animation_version_id", "template_version_id", "target_frame_count", "file_version_no");
CREATE INDEX "production_print_files_asset_id_animation_version_id_created_at_idx" ON "production_print_files"("asset_id", "animation_version_id", "created_at");
CREATE INDEX "production_print_files_production_batch_id_idx" ON "production_print_files"("production_batch_id");
ALTER TABLE "production_print_files" ADD CONSTRAINT "production_print_files_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "animation_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_print_files" ADD CONSTRAINT "production_print_files_animation_version_id_fkey" FOREIGN KEY ("animation_version_id") REFERENCES "animation_asset_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_print_files" ADD CONSTRAINT "production_print_files_render_id_fkey" FOREIGN KEY ("render_id") REFERENCES "production_frame_renders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_print_files" ADD CONSTRAINT "production_print_files_template_version_id_fkey" FOREIGN KEY ("template_version_id") REFERENCES "print_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
