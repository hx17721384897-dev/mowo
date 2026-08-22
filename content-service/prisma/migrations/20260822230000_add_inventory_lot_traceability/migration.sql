ALTER TABLE "customize_orders"
  ADD COLUMN "replacement_for_id" TEXT,
  ADD COLUMN "aftersale_request_id" TEXT;

ALTER TABLE "sku_inventory"
  ADD COLUMN "service_stock" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "material_items"
  ADD COLUMN "service_stock" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "material_receipts"
  ADD COLUMN "available_qty" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "location" VARCHAR(100),
  ADD COLUMN "status" VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
  ADD COLUMN "stock_class" VARCHAR(20) NOT NULL DEFAULT 'NEW',
  ADD COLUMN "source_return_receipt_id" TEXT;

ALTER TABLE "material_preparation_batches"
  ADD COLUMN "available_qty" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "location" VARCHAR(100),
  ADD COLUMN "status" VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
  ADD COLUMN "stock_class" VARCHAR(20) NOT NULL DEFAULT 'NEW',
  ADD COLUMN "source_return_receipt_id" TEXT;

ALTER TABLE "material_preparation_inputs"
  ADD COLUMN "source_receipt_id" TEXT;

ALTER TABLE "kit_assembly_batches"
  ADD COLUMN "available_qty" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "status" VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
  ADD COLUMN "stock_class" VARCHAR(20) NOT NULL DEFAULT 'NEW',
  ADD COLUMN "batch_type" VARCHAR(30) NOT NULL DEFAULT 'ASSEMBLED',
  ADD COLUMN "source_return_receipt_id" TEXT;

CREATE TABLE "kit_assembly_consumptions" (
  "id" TEXT NOT NULL,
  "kit_assembly_batch_id" TEXT NOT NULL,
  "material_id" TEXT NOT NULL,
  "source_type" VARCHAR(20) NOT NULL,
  "source_batch_id" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "kit_assembly_consumptions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "kit_assembly_consumptions_kit_assembly_batch_id_idx" ON "kit_assembly_consumptions"("kit_assembly_batch_id");
CREATE INDEX "kit_assembly_consumptions_source_type_source_batch_id_idx" ON "kit_assembly_consumptions"("source_type", "source_batch_id");
ALTER TABLE "kit_assembly_consumptions" ADD CONSTRAINT "kit_assembly_consumptions_kit_assembly_batch_id_fkey"
  FOREIGN KEY ("kit_assembly_batch_id") REFERENCES "kit_assembly_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "inventory_return_receipts" (
  "id" TEXT NOT NULL,
  "return_no" VARCHAR(50) NOT NULL,
  "aftersale_request_id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "tracking_no" VARCHAR(100),
  "tracking_company" VARCHAR(100),
  "status" VARCHAR(30) NOT NULL DEFAULT 'QUARANTINED',
  "received_by" TEXT NOT NULL,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "inspected_by" TEXT,
  "inspected_at" TIMESTAMP(3),
  "note" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "inventory_return_receipts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "inventory_return_receipts_return_no_key" ON "inventory_return_receipts"("return_no");
CREATE INDEX "inventory_return_receipts_status_received_at_idx" ON "inventory_return_receipts"("status", "received_at");
CREATE INDEX "inventory_return_receipts_aftersale_request_id_idx" ON "inventory_return_receipts"("aftersale_request_id");

CREATE TABLE "inventory_return_inspection_items" (
  "id" TEXT NOT NULL,
  "return_receipt_id" TEXT NOT NULL,
  "inventory_level" VARCHAR(30) NOT NULL,
  "material_id" TEXT,
  "sku_id" TEXT,
  "received_qty" INTEGER NOT NULL,
  "disposition" VARCHAR(30) NOT NULL,
  "result_batch_type" VARCHAR(30),
  "result_batch_id" TEXT,
  "note" VARCHAR(300),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_return_inspection_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "inventory_return_inspection_items_return_receipt_id_idx" ON "inventory_return_inspection_items"("return_receipt_id");
ALTER TABLE "inventory_return_inspection_items" ADD CONSTRAINT "inventory_return_inspection_items_return_receipt_id_fkey"
  FOREIGN KEY ("return_receipt_id") REFERENCES "inventory_return_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing records did not track remaining quantities by lot. Preserve current totals
-- as one clearly marked opening lot per item; old receipts remain immutable history.
INSERT INTO "material_receipts" (
  "id", "receipt_no", "material_id", "ordered_spec", "actual_qty", "accepted_qty",
  "available_qty", "rejected_qty", "supplier_name", "supplier_lot_no", "location",
  "status", "stock_class", "operator_id", "note", "created_at"
)
SELECT
  md5(random()::text || clock_timestamp()::text || m."id"),
  'LEGACY-' || upper(substr(md5(random()::text || m."id"), 1, 10)),
  m."id", '批次追踪启用前的期初余额', m."current_stock", m."current_stock",
  m."current_stock", 0, NULL, NULL, NULL,
  'AVAILABLE', 'NEW', m."created_by", '系统迁移：原库存无批次明细', CURRENT_TIMESTAMP
FROM "material_items" m
WHERE m."current_stock" > 0;

UPDATE "material_preparation_batches" SET "status" = 'EXHAUSTED';
UPDATE "kit_assembly_batches" SET "available_qty" = "quantity";

CREATE INDEX "customize_orders_replacement_for_id_idx" ON "customize_orders"("replacement_for_id");
CREATE INDEX "customize_orders_aftersale_request_id_idx" ON "customize_orders"("aftersale_request_id");
