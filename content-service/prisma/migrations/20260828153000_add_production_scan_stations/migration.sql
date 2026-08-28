ALTER TABLE "kit_assembly_batches"
  ADD COLUMN "reserved_qty" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "kit_containers"
  ADD COLUMN "reserved_qty" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "production_material_picks" (
  "id" TEXT NOT NULL,
  "batch_id" VARCHAR(40) NOT NULL,
  "sku_id" TEXT NOT NULL,
  "kit_assembly_batch_id" TEXT NOT NULL,
  "kit_container_id" TEXT,
  "quantity" INTEGER NOT NULL,
  "remaining_qty" INTEGER NOT NULL,
  "consumed_qty" INTEGER NOT NULL DEFAULT 0,
  "returned_qty" INTEGER NOT NULL DEFAULT 0,
  "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  "picked_by" TEXT NOT NULL,
  "picked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "returned_by" TEXT,
  "returned_at" TIMESTAMP(3),
  "return_reason" VARCHAR(300),
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "production_material_picks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "production_material_picks_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "production_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "production_material_picks_kit_batch_id_fkey" FOREIGN KEY ("kit_assembly_batch_id") REFERENCES "kit_assembly_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "production_material_picks_kit_container_id_fkey" FOREIGN KEY ("kit_container_id") REFERENCES "kit_containers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "production_material_picks_positive_quantity" CHECK ("quantity" > 0),
  CONSTRAINT "production_material_picks_nonnegative_totals" CHECK ("remaining_qty" >= 0 AND "consumed_qty" >= 0 AND "returned_qty" >= 0),
  CONSTRAINT "production_material_picks_balanced_totals" CHECK ("remaining_qty" + "consumed_qty" + "returned_qty" = "quantity")
);

CREATE INDEX "production_material_picks_batch_status_picked_idx" ON "production_material_picks"("batch_id", "status", "picked_at");
CREATE INDEX "production_material_picks_batch_sku_status_idx" ON "production_material_picks"("batch_id", "sku_id", "status");
CREATE INDEX "production_material_picks_kit_batch_status_idx" ON "production_material_picks"("kit_assembly_batch_id", "status");
