-- 同步之前 db push 的变更 + 新增联络表单

-- collab_frame_packs 表
CREATE TABLE IF NOT EXISTS "collab_frame_packs" (
    "id" TEXT NOT NULL,
    "collab_work_id" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "oss_path" TEXT,
    "local_cache_path" TEXT,
    "stock_type" TEXT NOT NULL DEFAULT 'on_demand',
    "current_stock" INTEGER NOT NULL DEFAULT 0,
    "reserved_stock" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "collab_frame_packs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "collab_frame_packs_collab_work_id_size_key"
    ON "collab_frame_packs"("collab_work_id", "size");

-- collab_works 新字段
ALTER TABLE "collab_works" ADD COLUMN IF NOT EXISTS "frame_pack_oss_path" TEXT;
ALTER TABLE "collab_works" ADD COLUMN IF NOT EXISTS "sizes" TEXT;
ALTER TABLE "collab_works" ADD COLUMN IF NOT EXISTS "is_on_shelf" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "collab_works" ADD COLUMN IF NOT EXISTS "shelf_at" TIMESTAMP(3);

-- customize_orders 新字段
ALTER TABLE "customize_orders" ADD COLUMN IF NOT EXISTS "seq_no" INTEGER;

-- 联络表单
CREATE TABLE IF NOT EXISTS "contact_submissions" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "extra" TEXT,
    "attachments" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "handled_by" TEXT,
    "handled_at" TIMESTAMP(3),
    "note" TEXT,
    "spam_score" INTEGER NOT NULL DEFAULT 0,
    "is_blocked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "contact_submissions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "contact_submissions_type_idx" ON "contact_submissions"("type");
CREATE INDEX IF NOT EXISTS "contact_submissions_status_idx" ON "contact_submissions"("status");
CREATE INDEX IF NOT EXISTS "contact_submissions_ip_idx" ON "contact_submissions"("ip");
CREATE INDEX IF NOT EXISTS "contact_submissions_created_at_idx" ON "contact_submissions"("created_at");
ALTER TABLE "contact_submissions" ADD COLUMN IF NOT EXISTS "is_starred" BOOLEAN NOT NULL DEFAULT false;