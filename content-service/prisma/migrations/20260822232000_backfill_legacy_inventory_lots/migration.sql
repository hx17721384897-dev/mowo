-- Packed items consume preparation lots. Add one clearly marked opening lot only
-- when no usable preparation lot exists. Historical receipts remain untouched.
INSERT INTO "material_preparation_batches" (
  "id", "batch_no", "output_material_id", "output_qty", "available_qty",
  "status", "stock_class", "operator_id", "note", "created_at"
)
SELECT
  md5(random()::text || clock_timestamp()::text || m."id"),
  'LEGACY-PREP-' || upper(substr(md5(random()::text || m."id"), 1, 8)),
  m."id", m."current_stock", m."current_stock", 'AVAILABLE', 'NEW', m."created_by",
  '系统迁移：批次追踪启用前的已分装库存余额', CURRENT_TIMESTAMP
FROM "material_items" m
WHERE m."item_type" = 'PACKED' AND m."current_stock" > 0
  AND NOT EXISTS (
    SELECT 1 FROM "material_preparation_batches" p
    WHERE p."output_material_id" = m."id" AND p."available_qty" > 0
  );

-- Add only a positive missing balance for standard kits. Existing assembly history
-- is never rewritten by this compatibility migration.
INSERT INTO "kit_assembly_batches" (
  "id", "batch_no", "sku_id", "quantity", "available_qty", "status",
  "stock_class", "batch_type", "bom_version", "bom_snapshot", "operator_id",
  "note", "created_at"
)
SELECT
  md5(random()::text || clock_timestamp()::text || i."sku_id"),
  'LEGACY-KIT-' || upper(substr(md5(random()::text || i."sku_id"), 1, 8)),
  i."sku_id", i."current_stock" - COALESCE(x."tracked_qty", 0),
  i."current_stock" - COALESCE(x."tracked_qty", 0), 'AVAILABLE', 'NEW',
  'OPENING_BALANCE', COALESCE(s."bom_version", 0), '[]', 'system-migration',
  '系统迁移：批次追踪启用前的标准材料包库存余额', CURRENT_TIMESTAMP
FROM "sku_inventory" i
LEFT JOIN "machine_model_skus" s ON s."id" = i."sku_id"
LEFT JOIN (
  SELECT "sku_id", SUM("available_qty") AS "tracked_qty"
  FROM "kit_assembly_batches"
  WHERE "status" = 'AVAILABLE'
  GROUP BY "sku_id"
) x ON x."sku_id" = i."sku_id"
WHERE i."current_stock" > COALESCE(x."tracked_qty", 0);
