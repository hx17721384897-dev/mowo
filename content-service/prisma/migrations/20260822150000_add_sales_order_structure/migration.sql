CREATE TABLE "sales_orders" (
    "id" TEXT NOT NULL,
    "order_no" VARCHAR(32) NOT NULL,
    "user_id" TEXT NOT NULL,
    "pre_order_id" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'paid',
    "total_amount" DECIMAL(10,2) NOT NULL,
    "receiver_name" TEXT,
    "receiver_phone" TEXT,
    "receiver_address" TEXT,
    "receiver_city" TEXT,
    "platform" VARCHAR(20) NOT NULL DEFAULT 'SELF',
    "paid_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_order_items" (
    "id" TEXT NOT NULL,
    "item_no" VARCHAR(40) NOT NULL,
    "sales_order_id" TEXT NOT NULL,
    "cart_item_id" TEXT,
    "item_type" VARCHAR(20) NOT NULL,
    "content_id" TEXT NOT NULL,
    "custom_product_id" TEXT,
    "animation_asset_id" TEXT,
    "animation_version_id" TEXT,
    "sku_id" TEXT NOT NULL,
    "sku_code" TEXT,
    "snapshot_title" TEXT NOT NULL,
    "snapshot_preview_url" TEXT,
    "config_snapshot_json" TEXT,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "line_total" DECIMAL(10,2) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'paid',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sales_order_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "customize_orders" ADD COLUMN "sales_order_item_id" TEXT;
ALTER TABLE "customize_orders" ADD COLUMN "unit_index" INTEGER;

CREATE UNIQUE INDEX "sales_orders_order_no_key" ON "sales_orders"("order_no");
CREATE UNIQUE INDEX "sales_orders_pre_order_id_key" ON "sales_orders"("pre_order_id");
CREATE INDEX "sales_orders_user_id_status_created_at_idx" ON "sales_orders"("user_id", "status", "created_at");
CREATE UNIQUE INDEX "sales_order_items_item_no_key" ON "sales_order_items"("item_no");
CREATE INDEX "sales_order_items_sales_order_id_idx" ON "sales_order_items"("sales_order_id");
CREATE INDEX "sales_order_items_animation_asset_id_animation_version_id_idx" ON "sales_order_items"("animation_asset_id", "animation_version_id");
CREATE INDEX "sales_order_items_sku_id_idx" ON "sales_order_items"("sku_id");
CREATE UNIQUE INDEX "customize_orders_sales_order_item_id_unit_index_key" ON "customize_orders"("sales_order_item_id", "unit_index");
CREATE INDEX "customize_orders_sales_order_item_id_idx" ON "customize_orders"("sales_order_item_id");

ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_pre_order_id_fkey" FOREIGN KEY ("pre_order_id") REFERENCES "pre_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_animation_asset_id_fkey" FOREIGN KEY ("animation_asset_id") REFERENCES "animation_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_animation_version_id_fkey" FOREIGN KEY ("animation_version_id") REFERENCES "animation_asset_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customize_orders" ADD CONSTRAINT "customize_orders_sales_order_item_id_fkey" FOREIGN KEY ("sales_order_item_id") REFERENCES "sales_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
