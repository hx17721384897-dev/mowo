-- 联名后台的货架治理字段及历史创作者通知/配额模型曾通过 db push 落入运行库。
-- 自助创作者入口仍保持下线；本迁移仅让现有员工后台和账户清理在空库具备合法结构，并保留历史数据边界。

ALTER TABLE "collab_works"
  ADD COLUMN IF NOT EXISTS "suspended_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "suspended_by" TEXT,
  ADD COLUMN IF NOT EXISTS "off_shelf_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "off_shelf_type" TEXT,
  ADD COLUMN IF NOT EXISTS "off_shelf_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "off_shelf_notice" TEXT,
  ADD COLUMN IF NOT EXISTS "can_resubmit" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "delist_requested_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "delist_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "submission_batch_id" TEXT,
  ADD COLUMN IF NOT EXISTS "original_work_id" TEXT,
  ADD COLUMN IF NOT EXISTS "change_log" TEXT;

CREATE INDEX IF NOT EXISTS "collab_works_submission_batch_id_idx"
  ON "collab_works"("submission_batch_id");
CREATE INDEX IF NOT EXISTS "collab_works_original_work_id_idx"
  ON "collab_works"("original_work_id");

CREATE TABLE IF NOT EXISTS "creator_notifications" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "type" VARCHAR(30) NOT NULL,
  "work_id" TEXT NOT NULL,
  "work_title" VARCHAR(100) NOT NULL,
  "message" TEXT,
  "is_read" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "creator_notifications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "creator_notifications_user_id_is_read_idx"
  ON "creator_notifications"("user_id", "is_read");
CREATE INDEX IF NOT EXISTS "creator_notifications_user_id_created_at_idx"
  ON "creator_notifications"("user_id", "created_at");

DO $$ BEGIN
  ALTER TABLE "creator_notifications" ADD CONSTRAINT "creator_notifications_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "content_quotas" (
  "id" TEXT NOT NULL,
  "collab_work_id" TEXT NOT NULL,
  "total_quota" INTEGER NOT NULL,
  "used_quota" INTEGER NOT NULL DEFAULT 0,
  "locked_quota" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "content_quotas_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "content_quotas_collab_work_id_key"
  ON "content_quotas"("collab_work_id");
