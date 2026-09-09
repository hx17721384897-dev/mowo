-- 当前产品注释明确支持“动画直接提交”的联名作品，因此 order_no 是可选业务来源。
-- 只放宽这一项与既有 Schema/代码一致的约束；不处理 users.phone 等尚属未来能力的可空差异。
ALTER TABLE "collab_works"
  ALTER COLUMN "order_no" DROP NOT NULL;
