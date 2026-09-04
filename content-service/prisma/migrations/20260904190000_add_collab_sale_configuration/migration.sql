ALTER TABLE "collab_works"
  ADD COLUMN IF NOT EXISTS "storefront_summary" VARCHAR(300),
  ADD COLUMN IF NOT EXISTS "storefront_sort_order" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "collab_sale_skus" (
  "id" TEXT NOT NULL,
  "collab_work_id" TEXT NOT NULL,
  "sku_id" TEXT NOT NULL,
  "final_price" DECIMAL(10,2) NOT NULL,
  "fulfillment_mode" VARCHAR(24) NOT NULL DEFAULT 'MAKE_TO_ORDER',
  "lead_time_days" INTEGER NOT NULL DEFAULT 7,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_by" TEXT NOT NULL,
  "updated_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "collab_sale_skus_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "collab_sale_skus_collab_work_id_sku_id_key"
  ON "collab_sale_skus"("collab_work_id", "sku_id");
CREATE INDEX IF NOT EXISTS "collab_sale_skus_collab_work_id_is_enabled_sort_order_idx"
  ON "collab_sale_skus"("collab_work_id", "is_enabled", "sort_order");
CREATE INDEX IF NOT EXISTS "collab_sale_skus_sku_id_is_enabled_idx"
  ON "collab_sale_skus"("sku_id", "is_enabled");

DO $$ BEGIN
  ALTER TABLE "collab_sale_skus"
    ADD CONSTRAINT "collab_sale_skus_collab_work_id_fkey"
    FOREIGN KEY ("collab_work_id") REFERENCES "collab_works"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "collab_sale_skus"
    ADD CONSTRAINT "collab_sale_skus_sku_id_fkey"
    FOREIGN KEY ("sku_id") REFERENCES "machine_model_skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 把现有作品的旧 supportedSkus/creatorMarkups 转为正式销售配置，避免升级后货架无故清空。
INSERT INTO "collab_sale_skus" (
  "id", "collab_work_id", "sku_id", "final_price", "fulfillment_mode",
  "lead_time_days", "sort_order", "is_enabled", "created_by", "updated_by", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  work."id",
  sku."id",
  (sku."price" + COALESCE(NULLIF(work."creator_markups", '')::jsonb ->> sku."id", '0')::numeric),
  'MAKE_TO_ORDER',
  7,
  item.ordinality - 1,
  true,
  COALESCE(work."approved_by", work."creator_id"),
  COALESCE(work."approved_by", work."creator_id"),
  CURRENT_TIMESTAMP
FROM "collab_works" work
CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(NULLIF(work."supported_skus", ''), '[]')::jsonb)
  WITH ORDINALITY AS item(sku_ref, ordinality)
JOIN "machine_model_skus" sku ON sku."id" = item.sku_ref OR sku."sku_code" = item.sku_ref
ON CONFLICT ("collab_work_id", "sku_id") DO NOTHING;
