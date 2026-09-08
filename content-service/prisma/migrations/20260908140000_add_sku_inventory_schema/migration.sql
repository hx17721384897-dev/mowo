-- SKU、库存事实源与外部订单辅助表曾通过 db push 落入运行库，缺少可重放迁移。
-- 此迁移只补当前 API 已经读取/写入的追加结构；不猜测 SKU、订单或联名数据的外键归属。

ALTER TABLE "machine_models"
  ADD COLUMN IF NOT EXISTS "model_type" TEXT NOT NULL DEFAULT 'single';

ALTER TABLE "machine_model_skus"
  ADD COLUMN IF NOT EXISTS "sku_code" VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "sku_type" VARCHAR(20) NOT NULL DEFAULT 'KIT',
  ADD COLUMN IF NOT EXISTS "license_expire_date" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "license_status" VARCHAR(20) DEFAULT 'Active';

ALTER TABLE "sku_inventory"
  ADD COLUMN IF NOT EXISTS "wip_frame_qty" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "wip_kit_qty" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "warehouse_id" TEXT NOT NULL DEFAULT '1',
  ADD COLUMN IF NOT EXISTS "finished_qty" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "safety_factor" DOUBLE PRECISION NOT NULL DEFAULT 1.0;

ALTER TABLE "inventory_logs"
  ADD COLUMN IF NOT EXISTS "idempotency_key" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "before_qty" INTEGER,
  ADD COLUMN IF NOT EXISTS "after_qty" INTEGER,
  ADD COLUMN IF NOT EXISTS "reason" VARCHAR(200);

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_logs_idempotency_key_key"
  ON "inventory_logs"("idempotency_key");
CREATE INDEX IF NOT EXISTS "inventory_logs_sku_id_idx"
  ON "inventory_logs"("sku_id");
CREATE INDEX IF NOT EXISTS "inventory_logs_order_id_idx"
  ON "inventory_logs"("order_id");

CREATE TABLE IF NOT EXISTS "platform_sku_mappings" (
  "id" TEXT NOT NULL,
  "platform" VARCHAR(10) NOT NULL,
  "external_desc" TEXT NOT NULL,
  "internal_sku_code" VARCHAR(50) NOT NULL,
  "collab_work_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "platform_sku_mappings_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "platform_sku_mappings_platform_idx"
  ON "platform_sku_mappings"("platform");

CREATE TABLE IF NOT EXISTS "inventory_snapshots" (
  "id" TEXT NOT NULL,
  "sku_id" TEXT NOT NULL,
  "total_qty" INTEGER NOT NULL,
  "available_qty" INTEGER NOT NULL,
  "locked_qty" INTEGER NOT NULL,
  "wip_frame_qty" INTEGER NOT NULL,
  "wip_kit_qty" INTEGER NOT NULL,
  "unit_cost" DECIMAL(10,2),
  "snapshot_date" DATE NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_snapshots_sku_id_snapshot_date_key"
  ON "inventory_snapshots"("sku_id", "snapshot_date");
CREATE INDEX IF NOT EXISTS "inventory_snapshots_snapshot_date_idx"
  ON "inventory_snapshots"("snapshot_date");

CREATE TABLE IF NOT EXISTS "order_item_bindings" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "tracking_no" TEXT,
  "source" VARCHAR(20) NOT NULL,
  "external_order_id" VARCHAR(100),
  "frame_code" VARCHAR(100),
  "kit_sku_id" TEXT,
  "batch_id" TEXT,
  "status" VARCHAR(20) NOT NULL DEFAULT 'Pending',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_item_bindings_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "order_item_bindings_order_id_idx"
  ON "order_item_bindings"("order_id");
CREATE INDEX IF NOT EXISTS "order_item_bindings_batch_id_idx"
  ON "order_item_bindings"("batch_id");

CREATE TABLE IF NOT EXISTS "channel_quotas" (
  "id" TEXT NOT NULL,
  "sku_id" TEXT NOT NULL,
  "buffer_pool" INTEGER NOT NULL DEFAULT 10,
  "taobao_qty" INTEGER NOT NULL DEFAULT 0,
  "douyin_qty" INTEGER NOT NULL DEFAULT 0,
  "xhs_qty" INTEGER NOT NULL DEFAULT 0,
  "livestream_mode" BOOLEAN NOT NULL DEFAULT false,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "channel_quotas_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "channel_quotas_sku_id_key"
  ON "channel_quotas"("sku_id");
