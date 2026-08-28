ALTER TABLE "production_frame_packs"
  ADD COLUMN "print_file_id" TEXT,
  ADD COLUMN "requested_pages" JSONB,
  ADD COLUMN "void_reason" TEXT,
  ADD COLUMN "voided_by" TEXT,
  ADD COLUMN "voided_at" TIMESTAMP(3);

CREATE TABLE "production_frame_reprints" (
  "id" TEXT NOT NULL,
  "production_unit_id" TEXT NOT NULL,
  "sales_order_id" TEXT NOT NULL,
  "batch_id" VARCHAR(40) NOT NULL,
  "old_frame_pack_id" TEXT NOT NULL,
  "old_frame_pack_code" VARCHAR(80) NOT NULL,
  "new_frame_pack_id" TEXT NOT NULL,
  "new_frame_pack_code" VARCHAR(80) NOT NULL,
  "production_print_file_id" TEXT NOT NULL,
  "requested_pages" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "requested_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "production_frame_reprints_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "production_frame_reprints_unit_created_idx" ON "production_frame_reprints"("production_unit_id", "created_at");
CREATE INDEX "production_frame_reprints_batch_created_idx" ON "production_frame_reprints"("batch_id", "created_at");
