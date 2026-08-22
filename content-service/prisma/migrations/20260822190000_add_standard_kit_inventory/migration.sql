ALTER TABLE "machine_model_skus" ADD COLUMN "bom_version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "material_items" ADD COLUMN "item_code" VARCHAR(50);
ALTER TABLE "material_items" ADD COLUMN "item_type" VARCHAR(20) NOT NULL DEFAULT 'RAW';
ALTER TABLE "material_items" ADD COLUMN "specification" VARCHAR(200);
ALTER TABLE "material_items" ADD COLUMN "source_material_id" TEXT;
ALTER TABLE "material_items" ADD COLUMN "source_qty_per_unit" INTEGER;

ALTER TABLE "material_logs" ADD COLUMN "reference_no" VARCHAR(50);
ALTER TABLE "material_sku_bindings" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "material_items_item_code_key" ON "material_items"("item_code");

CREATE TABLE "material_receipts" (
    "id" TEXT NOT NULL,
    "receipt_no" VARCHAR(50) NOT NULL,
    "material_id" TEXT NOT NULL,
    "ordered_spec" VARCHAR(200),
    "actual_qty" INTEGER NOT NULL,
    "accepted_qty" INTEGER NOT NULL,
    "rejected_qty" INTEGER NOT NULL DEFAULT 0,
    "supplier_name" VARCHAR(100),
    "supplier_lot_no" VARCHAR(100),
    "operator_id" TEXT NOT NULL,
    "note" VARCHAR(300),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "material_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "material_receipts_receipt_no_key" ON "material_receipts"("receipt_no");
CREATE INDEX "material_receipts_material_id_created_at_idx" ON "material_receipts"("material_id", "created_at");
ALTER TABLE "material_receipts" ADD CONSTRAINT "material_receipts_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "material_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "material_preparation_batches" (
    "id" TEXT NOT NULL,
    "batch_no" VARCHAR(50) NOT NULL,
    "output_material_id" TEXT NOT NULL,
    "output_qty" INTEGER NOT NULL,
    "operator_id" TEXT NOT NULL,
    "note" VARCHAR(300),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "material_preparation_batches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "material_preparation_batches_batch_no_key" ON "material_preparation_batches"("batch_no");
CREATE INDEX "material_preparation_batches_output_material_id_created_at_idx" ON "material_preparation_batches"("output_material_id", "created_at");

CREATE TABLE "material_preparation_inputs" (
    "id" TEXT NOT NULL,
    "prep_batch_id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "used_qty" INTEGER NOT NULL,
    "loss_qty" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "material_preparation_inputs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "material_preparation_inputs_material_id_idx" ON "material_preparation_inputs"("material_id");
ALTER TABLE "material_preparation_inputs" ADD CONSTRAINT "material_preparation_inputs_prep_batch_id_fkey" FOREIGN KEY ("prep_batch_id") REFERENCES "material_preparation_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "kit_containers" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "sku_id" TEXT NOT NULL,
    "current_qty" INTEGER NOT NULL DEFAULT 0,
    "location" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "kit_containers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "kit_containers_code_key" ON "kit_containers"("code");
CREATE INDEX "kit_containers_sku_id_idx" ON "kit_containers"("sku_id");

CREATE TABLE "kit_assembly_batches" (
    "id" TEXT NOT NULL,
    "batch_no" VARCHAR(50) NOT NULL,
    "sku_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "bom_version" INTEGER NOT NULL,
    "bom_snapshot" TEXT NOT NULL,
    "container_id" TEXT,
    "operator_id" TEXT NOT NULL,
    "note" VARCHAR(300),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kit_assembly_batches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "kit_assembly_batches_batch_no_key" ON "kit_assembly_batches"("batch_no");
CREATE INDEX "kit_assembly_batches_sku_id_created_at_idx" ON "kit_assembly_batches"("sku_id", "created_at");
CREATE INDEX "kit_assembly_batches_container_id_idx" ON "kit_assembly_batches"("container_id");
ALTER TABLE "kit_assembly_batches" ADD CONSTRAINT "kit_assembly_batches_container_id_fkey" FOREIGN KEY ("container_id") REFERENCES "kit_containers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
