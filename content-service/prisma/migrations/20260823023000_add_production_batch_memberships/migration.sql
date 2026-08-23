-- 显式生产批次骨架。旧环境可能通过 db push 已经拥有 production_batches/batch_items，
-- 因此先补齐旧主表，再追加新字段和正式成员关系。
CREATE TABLE IF NOT EXISTS "production_batches" (
  "id" TEXT NOT NULL,
  "operator_id" TEXT NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'READY',
  "max_capacity" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "production_batches_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "production_batches" ADD COLUMN IF NOT EXISTS "warning_snapshot" JSONB;
ALTER TABLE "production_batches" ADD COLUMN IF NOT EXISTS "sales_order_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "production_batches" ADD COLUMN IF NOT EXISTS "production_unit_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "production_batches" ADD COLUMN IF NOT EXISTS "sku_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "production_batches" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS "batch_items" (
  "id" TEXT NOT NULL,
  "batch_id" TEXT NOT NULL,
  "sku_id" TEXT NOT NULL,
  "sku_code" VARCHAR(50),
  "planned_qty" INTEGER NOT NULL DEFAULT 0,
  "actual_qty" INTEGER NOT NULL DEFAULT 0,
  "defect_qty" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "batch_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "batch_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "production_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "batch_items_batch_id_sku_id_key" ON "batch_items"("batch_id", "sku_id");
CREATE INDEX IF NOT EXISTS "batch_items_batch_id_idx" ON "batch_items"("batch_id");

CREATE TABLE "production_batch_orders" (
  "id" TEXT NOT NULL,
  "batch_id" TEXT NOT NULL,
  "sales_order_id" TEXT NOT NULL,
  "order_no_snapshot" VARCHAR(40) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'WAITING',
  "warning_snapshot" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "production_batch_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "production_batch_orders_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "production_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "production_batch_orders_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "production_batch_orders_batch_id_sales_order_id_key" ON "production_batch_orders"("batch_id", "sales_order_id");
CREATE INDEX "production_batch_orders_sales_order_id_status_idx" ON "production_batch_orders"("sales_order_id", "status");

CREATE TABLE "production_batch_units" (
  "id" TEXT NOT NULL,
  "batch_id" TEXT NOT NULL,
  "production_unit_id" TEXT NOT NULL,
  "sales_order_id" TEXT NOT NULL,
  "sku_id" TEXT NOT NULL,
  "production_no_snapshot" VARCHAR(40) NOT NULL,
  "frame_status" VARCHAR(20) NOT NULL DEFAULT 'WAITING',
  "material_status" VARCHAR(20) NOT NULL DEFAULT 'WAITING',
  "pairing_status" VARCHAR(20) NOT NULL DEFAULT 'WAITING',
  "package_status" VARCHAR(20) NOT NULL DEFAULT 'WAITING',
  "exception_status" VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "production_batch_units_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "production_batch_units_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "production_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "production_batch_units_batch_id_production_unit_id_key" ON "production_batch_units"("batch_id", "production_unit_id");
CREATE INDEX "production_batch_units_production_unit_id_idx" ON "production_batch_units"("production_unit_id");
CREATE INDEX "production_batch_units_batch_id_sku_id_idx" ON "production_batch_units"("batch_id", "sku_id");
CREATE INDEX "production_batch_units_sales_order_id_package_status_idx" ON "production_batch_units"("sales_order_id", "package_status");
