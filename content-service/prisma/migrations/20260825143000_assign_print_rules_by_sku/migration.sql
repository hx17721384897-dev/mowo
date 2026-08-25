ALTER TABLE "print_cut_rules" ADD COLUMN "sku_id" TEXT;
ALTER TABLE "print_cut_rules" ALTER COLUMN "size" DROP NOT NULL;
ALTER TABLE "print_cut_rules" ALTER COLUMN "frame_count" DROP NOT NULL;
DROP INDEX "print_cut_rules_size_frame_count_key";

-- Expand each legacy size/frame rule to every existing SKU that it previously matched.
INSERT INTO "print_cut_rules" (
  "id", "group_id", "size", "frame_count", "sku_id", "pages_per_unit",
  "sort_order", "is_active", "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  legacy."group_id",
  NULL,
  NULL,
  sku."id",
  legacy."pages_per_unit",
  legacy."sort_order" * 10000
    + ROW_NUMBER() OVER (
      PARTITION BY legacy."id"
      ORDER BY model."sortOrder", sku."sort_order", sku."created_at"
    )::integer - 1,
  legacy."is_active",
  legacy."created_at",
  CURRENT_TIMESTAMP
FROM "print_cut_rules" legacy
JOIN "machine_model_skus" sku
  ON sku."size" = legacy."size" AND sku."frame_count" = legacy."frame_count"
JOIN "machine_models" model ON model."id" = sku."model_id"
WHERE legacy."sku_id" IS NULL;

-- Keep legacy aggregate rules as inactive history so this migration never discards data.
UPDATE "print_cut_rules" SET "is_active" = false WHERE "sku_id" IS NULL;
ALTER TABLE "print_cut_rules"
  ADD CONSTRAINT "print_cut_rules_sku_id_fkey"
  FOREIGN KEY ("sku_id") REFERENCES "machine_model_skus"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "print_cut_rules_sku_id_key" ON "print_cut_rules"("sku_id");
