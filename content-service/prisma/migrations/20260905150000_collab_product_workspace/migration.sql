ALTER TABLE "collab_works"
  ADD COLUMN "product_no" VARCHAR(40),
  ADD COLUMN "storefront_title" VARCHAR(120),
  ADD COLUMN "storefront_media" TEXT NOT NULL DEFAULT '[]',
  ADD COLUMN "storefront_tags" TEXT NOT NULL DEFAULT '[]',
  ADD COLUMN "storefront_series" VARCHAR(80),
  ADD COLUMN "storefront_keywords" VARCHAR(300),
  ADD COLUMN "storefront_updated_by" TEXT;

UPDATE "collab_works"
SET "product_no" = 'COL-' || UPPER(SUBSTRING(REPLACE("id", '-', '') FROM 1 FOR 12))
WHERE "product_no" IS NULL;

CREATE UNIQUE INDEX "collab_works_product_no_key" ON "collab_works"("product_no");
