CREATE TABLE "print_cut_groups" (
  "id" TEXT NOT NULL,
  "code" VARCHAR(40) NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "size" VARCHAR(20) NOT NULL,
  "paper_size" VARCHAR(20) NOT NULL DEFAULT 'A4',
  "frames_per_sheet" INTEGER NOT NULL,
  "cutting_tool" VARCHAR(80),
  "template_key" VARCHAR(120),
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "print_cut_groups_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "print_cut_groups_code_key" ON "print_cut_groups"("code");
CREATE INDEX "print_cut_groups_is_active_sort_order_idx" ON "print_cut_groups"("is_active", "sort_order");

CREATE TABLE "print_cut_rules" (
  "id" TEXT NOT NULL,
  "group_id" TEXT NOT NULL,
  "size" VARCHAR(20) NOT NULL,
  "frame_count" INTEGER NOT NULL,
  "pages_per_unit" INTEGER NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "print_cut_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "print_cut_rules_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "print_cut_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "print_cut_rules_size_frame_count_key" ON "print_cut_rules"("size", "frame_count");
CREATE INDEX "print_cut_rules_group_id_is_active_sort_order_idx" ON "print_cut_rules"("group_id", "is_active", "sort_order");

ALTER TABLE "production_batches" ADD COLUMN IF NOT EXISTS "print_plan_snapshot" JSONB;
ALTER TABLE "production_batch_units" ADD COLUMN IF NOT EXISTS "print_group_id" TEXT;
ALTER TABLE "production_batch_units" ADD COLUMN IF NOT EXISTS "print_group_code" VARCHAR(40);
ALTER TABLE "production_batch_units" ADD COLUMN IF NOT EXISTS "print_group_name" VARCHAR(80);
ALTER TABLE "production_batch_units" ADD COLUMN IF NOT EXISTS "print_rule_id" TEXT;
ALTER TABLE "production_batch_units" ADD COLUMN IF NOT EXISTS "print_sequence" INTEGER;
ALTER TABLE "production_batch_units" ADD COLUMN IF NOT EXISTS "print_page_count" INTEGER;
ALTER TABLE "production_batch_units" ADD COLUMN IF NOT EXISTS "print_rule_snapshot" JSONB;
CREATE INDEX "production_batch_units_batch_id_print_sequence_idx" ON "production_batch_units"("batch_id", "print_sequence");
