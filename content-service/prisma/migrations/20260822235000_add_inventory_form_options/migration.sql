CREATE TABLE "inventory_form_options" (
  "id" TEXT NOT NULL,
  "category" VARCHAR(20) NOT NULL,
  "scope" VARCHAR(20) NOT NULL,
  "value" VARCHAR(100) NOT NULL,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_form_options_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inventory_form_options_category_scope_value_key"
  ON "inventory_form_options"("category", "scope", "value");
CREATE INDEX "inventory_form_options_category_scope_idx"
  ON "inventory_form_options"("category", "scope");

INSERT INTO "inventory_form_options" ("id", "category", "scope", "value", "created_by")
SELECT md5(random()::text || x."scope" || x."value"), 'NAME', x."scope", x."value", 'system-migration'
FROM (
  VALUES
    ('RAW', '铁丝'), ('RAW', '双面胶'), ('RAW', '润滑蜡'), ('RAW', '木板'), ('RAW', '手机支架'), ('RAW', '说明书'),
    ('PACKED', '铁丝包'), ('PACKED', '双面胶包'), ('PACKED', '润滑蜡小包')
) AS x("scope", "value")
ON CONFLICT DO NOTHING;

INSERT INTO "inventory_form_options" ("id", "category", "scope", "value", "created_by")
SELECT md5(random()::text || m."item_type" || m."name"), 'NAME',
  CASE WHEN m."item_type" = 'PACKED' THEN 'PACKED' ELSE 'RAW' END,
  m."name", 'system-migration'
FROM "material_items" m
ON CONFLICT DO NOTHING;

INSERT INTO "inventory_form_options" ("id", "category", "scope", "value", "created_by")
SELECT md5(random()::text || x."value"), 'UNIT', 'ALL', x."value", 'system-migration'
FROM (VALUES ('个'), ('根'), ('张'), ('克'), ('包'), ('套'), ('块'), ('份'), ('卷')) AS x("value")
ON CONFLICT DO NOTHING;

INSERT INTO "inventory_form_options" ("id", "category", "scope", "value", "created_by")
SELECT md5(random()::text || m."unit"), 'UNIT', 'ALL', m."unit", 'system-migration'
FROM "material_items" m
WHERE m."unit" IS NOT NULL AND btrim(m."unit") <> ''
ON CONFLICT DO NOTHING;
