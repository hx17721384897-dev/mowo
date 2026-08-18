DO $$ BEGIN
  CREATE TYPE "StaffRole" AS ENUM ('OWNER', 'CUSTOMER_SERVICE', 'PRODUCTION', 'COLLAB_OPS');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "staff_role" "StaffRole";

UPDATE "users"
SET "staff_role" = CASE
  WHEN "role" = 3 THEN 'OWNER'::"StaffRole"
  WHEN "role" = 2 THEN 'CUSTOMER_SERVICE'::"StaffRole"
  WHEN "role" = 1 THEN 'PRODUCTION'::"StaffRole"
  ELSE NULL
END
WHERE "staff_role" IS NULL;

-- 旧数字等级只保留“是否为后台账号”的兼容作用，具体权限由 staff_role 决定。
UPDATE "users" SET "role" = 2 WHERE "staff_role" = 'PRODUCTION' AND "role" = 1;

ALTER TABLE "operation_logs" ADD COLUMN IF NOT EXISTS "outcome" VARCHAR(20) NOT NULL DEFAULT 'SUCCESS';
ALTER TABLE "operation_logs" ADD COLUMN IF NOT EXISTS "status_code" INTEGER;
ALTER TABLE "operation_logs" ADD COLUMN IF NOT EXISTS "session_id" VARCHAR(100);
ALTER TABLE "operation_logs" ADD COLUMN IF NOT EXISTS "user_agent" VARCHAR(500);

CREATE INDEX IF NOT EXISTS "operation_logs_outcome_created_at_idx" ON "operation_logs"("outcome", "created_at");
CREATE INDEX IF NOT EXISTS "operation_logs_user_id_created_at_idx" ON "operation_logs"("user_id", "created_at");

-- 旧通用日志曾可能保存完整请求体；无法可靠逐字段判断时，安全地移除高风险历史详情。
UPDATE "operation_logs"
SET "after" = '"[HISTORICAL_SENSITIVE_DETAIL_REMOVED]"'
WHERE "after" IS NOT NULL
  AND (
    "path" ILIKE '%password%'
    OR "path" ILIKE '%phone%'
    OR "path" ILIKE '%address%'
    OR "path" ILIKE '%auth%'
    OR "after" ~* 'password|otp|token|authorization|receiverPhone|receiverAddress|trackingNo'
  );
