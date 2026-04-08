-- AlterTable
ALTER TABLE "customize_orders" ADD COLUMN     "inventory_status" VARCHAR(20) NOT NULL DEFAULT 'normal';

-- AlterTable
ALTER TABLE "machine_model_skus" ADD COLUMN     "sku_barcode" VARCHAR(50);

-- CreateTable
CREATE TABLE "sku_inventory" (
    "id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "current_stock" INTEGER NOT NULL DEFAULT 0,
    "reserved_stock" INTEGER NOT NULL DEFAULT 0,
    "safety_stock" INTEGER NOT NULL DEFAULT 10,
    "max_order_limit" INTEGER NOT NULL DEFAULT 100,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sku_inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_logs" (
    "id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "order_id" TEXT,
    "operator_id" TEXT NOT NULL,
    "note" VARCHAR(200),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_codes" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "order_id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL,
    "queried_count" INTEGER NOT NULL DEFAULT 0,
    "last_queried_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sku_inventory_sku_id_key" ON "sku_inventory"("sku_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_codes_code_key" ON "auth_codes"("code");
