ALTER TABLE "collab_works"
  ADD COLUMN "storefront_view_count" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "collab_storefront_views" (
  "id" TEXT NOT NULL,
  "collab_work_id" TEXT NOT NULL,
  "fingerprint_hash" VARCHAR(64) NOT NULL,
  "view_date" DATE NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "collab_storefront_views_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "collab_storefront_views_collab_work_id_fingerprint_hash_view_date_key"
  ON "collab_storefront_views"("collab_work_id", "fingerprint_hash", "view_date");
CREATE INDEX "collab_storefront_views_collab_work_id_created_at_idx"
  ON "collab_storefront_views"("collab_work_id", "created_at");
CREATE INDEX "collab_storefront_views_created_at_idx"
  ON "collab_storefront_views"("created_at");
CREATE INDEX "collab_works_storefront_recommended_idx"
  ON "collab_works"("status", "is_on_shelf", "shelf_status", "is_revision", "storefront_sort_order");
CREATE INDEX "collab_works_storefront_popular_idx"
  ON "collab_works"("status", "is_on_shelf", "shelf_status", "is_revision", "storefront_view_count");

ALTER TABLE "collab_storefront_views"
  ADD CONSTRAINT "collab_storefront_views_collab_work_id_fkey"
  FOREIGN KEY ("collab_work_id") REFERENCES "collab_works"("id") ON DELETE CASCADE ON UPDATE CASCADE;
