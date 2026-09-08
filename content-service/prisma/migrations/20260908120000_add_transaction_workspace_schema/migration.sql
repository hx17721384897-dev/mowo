-- 交易工作区曾通过 db push 落入运行库，缺少可重放迁移。
-- 本迁移只补 B1 当前读取/写入的购物车、地址、售后和订单扩展结构；
-- 在线结算与支付仍由 ONLINE_CHECKOUT_ENABLED 默认关闭。

ALTER TABLE "customize_orders"
  ADD COLUMN IF NOT EXISTS "aftersale_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "platform" VARCHAR(20) NOT NULL DEFAULT 'SELF',
  ADD COLUMN IF NOT EXISTS "external_order_id" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "lock_status" VARCHAR(20) NOT NULL DEFAULT 'UNLOCKED',
  ADD COLUMN IF NOT EXISTS "priority_level" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "buyer_note" VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "import_status" VARCHAR(20);

CREATE UNIQUE INDEX IF NOT EXISTS "customize_orders_platform_external_order_id_key"
  ON "customize_orders"("platform", "external_order_id");

CREATE TABLE IF NOT EXISTS "aftersale_requests" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "type" VARCHAR(20) NOT NULL,
  "reason" VARCHAR(100) NOT NULL,
  "description" TEXT,
  "image_urls" TEXT NOT NULL DEFAULT '[]',
  "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  "admin_note" TEXT,
  "admin_id" TEXT,
  "processed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "aftersale_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "carts" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "carts_user_id_key" ON "carts"("user_id");

CREATE TABLE IF NOT EXISTS "cart_items" (
  "id" TEXT NOT NULL,
  "cart_id" TEXT NOT NULL,
  "item_type" TEXT NOT NULL,
  "content_id" TEXT NOT NULL,
  "hardware_sku_id" TEXT NOT NULL,
  "hardware_sku_code" TEXT,
  "snapshot_title" TEXT NOT NULL,
  "snapshot_preview_url" TEXT,
  "cover_url" TEXT,
  "config_snapshot_json" TEXT,
  "snapshot_price" DECIMAL(10,2),
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "selected" BOOLEAN NOT NULL DEFAULT true,
  "creator_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'normal',
  "custom_product_id" TEXT,
  "session_group_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "cart_items_cart_id_idx" ON "cart_items"("cart_id");
CREATE INDEX IF NOT EXISTS "cart_items_session_group_id_idx" ON "cart_items"("session_group_id");

CREATE TABLE IF NOT EXISTS "user_addresses" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "label" TEXT,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "province" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "district" TEXT NOT NULL,
  "detail" TEXT NOT NULL,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_addresses_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "user_addresses_user_id_idx" ON "user_addresses"("user_id");

DO $$ BEGIN
  ALTER TABLE "aftersale_requests" ADD CONSTRAINT "aftersale_requests_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "customize_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "aftersale_requests" ADD CONSTRAINT "aftersale_requests_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "carts" ADD CONSTRAINT "carts_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_fkey"
    FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "user_addresses" ADD CONSTRAINT "user_addresses_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
