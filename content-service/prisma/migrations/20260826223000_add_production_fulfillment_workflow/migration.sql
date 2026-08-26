ALTER TABLE "sales_orders"
  ADD COLUMN "fulfillment_status" VARCHAR(30) NOT NULL DEFAULT 'PAID',
  ADD COLUMN "address_exported_at" TIMESTAMP(3),
  ADD COLUMN "tracking_no" VARCHAR(100),
  ADD COLUMN "tracking_company" VARCHAR(100),
  ADD COLUMN "tracking_bound_at" TIMESTAMP(3),
  ADD COLUMN "production_started_at" TIMESTAMP(3),
  ADD COLUMN "ready_to_ship_at" TIMESTAMP(3),
  ADD COLUMN "shipped_at" TIMESTAMP(3);

CREATE TABLE "production_frame_packs" (
  "id" TEXT NOT NULL, "code" VARCHAR(80) NOT NULL, "production_unit_id" TEXT NOT NULL,
  "sales_order_id" TEXT NOT NULL, "batch_id" VARCHAR(40) NOT NULL, "sku_id" TEXT NOT NULL,
  "animation_version_id" TEXT, "target_frame_count" INTEGER NOT NULL, "size" VARCHAR(30) NOT NULL,
  "attempt_no" INTEGER NOT NULL DEFAULT 1, "status" VARCHAR(20) NOT NULL DEFAULT 'CREATED',
  "is_active" BOOLEAN NOT NULL DEFAULT true, "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "production_frame_packs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "production_frame_packs_code_key" ON "production_frame_packs"("code");
CREATE UNIQUE INDEX "production_frame_packs_unit_attempt_key" ON "production_frame_packs"("production_unit_id", "attempt_no");
CREATE INDEX "production_frame_packs_batch_status_idx" ON "production_frame_packs"("batch_id", "status");
CREATE INDEX "production_frame_packs_order_status_idx" ON "production_frame_packs"("sales_order_id", "status");

CREATE TABLE "production_unit_pairings" (
  "id" TEXT NOT NULL, "production_unit_id" TEXT NOT NULL, "sales_order_id" TEXT NOT NULL,
  "batch_id" VARCHAR(40) NOT NULL, "frame_pack_id" TEXT NOT NULL, "sku_id" TEXT NOT NULL,
  "kit_assembly_batch_id" TEXT NOT NULL, "kit_container_id" TEXT,
  "status" VARCHAR(20) NOT NULL DEFAULT 'PAIRED', "paired_by" TEXT NOT NULL,
  "paired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "packed_at" TIMESTAMP(3), "shipped_at" TIMESTAMP(3),
  CONSTRAINT "production_unit_pairings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "production_unit_pairings_unit_key" ON "production_unit_pairings"("production_unit_id");
CREATE UNIQUE INDEX "production_unit_pairings_frame_pack_key" ON "production_unit_pairings"("frame_pack_id");
CREATE INDEX "production_unit_pairings_batch_status_idx" ON "production_unit_pairings"("batch_id", "status");
CREATE INDEX "production_unit_pairings_order_status_idx" ON "production_unit_pairings"("sales_order_id", "status");
CREATE INDEX "production_unit_pairings_kit_batch_idx" ON "production_unit_pairings"("kit_assembly_batch_id");

CREATE TABLE "production_packing_sessions" (
  "id" TEXT NOT NULL, "sales_order_id" TEXT NOT NULL, "batch_id" VARCHAR(40) NOT NULL,
  "tracking_no" VARCHAR(100) NOT NULL, "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  "started_by" TEXT NOT NULL, "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3), "shipped_at" TIMESTAMP(3), "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "production_packing_sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "production_packing_sessions_order_key" ON "production_packing_sessions"("sales_order_id");
CREATE INDEX "production_packing_sessions_tracking_idx" ON "production_packing_sessions"("tracking_no");
CREATE INDEX "production_packing_sessions_batch_status_idx" ON "production_packing_sessions"("batch_id", "status");

CREATE TABLE "production_packing_scans" (
  "id" TEXT NOT NULL, "session_id" TEXT NOT NULL, "production_unit_id" TEXT NOT NULL,
  "frame_pack_id" TEXT NOT NULL, "scanned_by" TEXT NOT NULL,
  "scanned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "production_packing_scans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "production_packing_scans_session_unit_key" ON "production_packing_scans"("session_id", "production_unit_id");
CREATE INDEX "production_packing_scans_frame_pack_idx" ON "production_packing_scans"("frame_pack_id");
ALTER TABLE "production_packing_scans" ADD CONSTRAINT "production_packing_scans_session_fkey" FOREIGN KEY ("session_id") REFERENCES "production_packing_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
