-- 帧包白名单库存与定制帧实例已由后台/生产代码使用，但早期通过 db push 建表。
-- 仅建立 Schema 明确表达的帧包层级关系；collab_work_id、order_id 保持软引用，待所有权规则审计后再决定外键。

CREATE TABLE IF NOT EXISTS "frame_pack_works" (
  "id" TEXT NOT NULL,
  "collab_work_id" TEXT,
  "name" VARCHAR(200) NOT NULL,
  "thumbnail_key" VARCHAR(500),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "frame_pack_works_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "frame_pack_works_collab_work_id_key"
  ON "frame_pack_works"("collab_work_id");

CREATE TABLE IF NOT EXISTS "frame_pack_variants" (
  "id" TEXT NOT NULL,
  "work_id" TEXT NOT NULL,
  "size" VARCHAR(20) NOT NULL,
  "frame_count" INTEGER NOT NULL,
  "sku_code" VARCHAR(50),
  "current_stock" INTEGER NOT NULL DEFAULT 0,
  "safety_stock" INTEGER NOT NULL DEFAULT 5,
  "lead_time" INTEGER NOT NULL DEFAULT 7,
  "note" VARCHAR(200),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "frame_pack_variants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "frame_pack_variants_work_id_size_frame_count_key"
  ON "frame_pack_variants"("work_id", "size", "frame_count");

CREATE TABLE IF NOT EXISTS "frame_pack_logs" (
  "id" TEXT NOT NULL,
  "variant_id" TEXT NOT NULL,
  "type" VARCHAR(30) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "before_qty" INTEGER NOT NULL,
  "after_qty" INTEGER NOT NULL,
  "operator_id" TEXT NOT NULL,
  "note" VARCHAR(200),
  "order_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "frame_pack_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "frame_pack_logs_variant_id_idx"
  ON "frame_pack_logs"("variant_id");

DO $$ BEGIN
  ALTER TABLE "frame_pack_variants" ADD CONSTRAINT "frame_pack_variants_work_id_fkey"
    FOREIGN KEY ("work_id") REFERENCES "frame_pack_works"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "frame_pack_logs" ADD CONSTRAINT "frame_pack_logs_variant_id_fkey"
    FOREIGN KEY ("variant_id") REFERENCES "frame_pack_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "frame_instances" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "template_sku_code" VARCHAR(50) NOT NULL,
  "image_url" TEXT,
  "print_file_url" TEXT,
  "content_hash" VARCHAR(64),
  "status" VARCHAR(20) NOT NULL DEFAULT 'Draft',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "frame_instances_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "frame_instances_order_id_idx"
  ON "frame_instances"("order_id");
