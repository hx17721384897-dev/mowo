-- 完成账号注销后必须移除可识别手机号；Prisma Schema 和注销服务均以此为正式行为。
-- 放宽既有列不会修改现有账号数据，只允许已注销账号把 phone 置为 NULL。
ALTER TABLE "users"
  ALTER COLUMN "phone" DROP NOT NULL;
