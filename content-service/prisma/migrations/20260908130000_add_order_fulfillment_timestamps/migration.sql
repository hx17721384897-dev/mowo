-- 每件 CustomizeOrder 是生产与物流事实来源；发货/收货时间由订单、生产和自动收货流程共同读取。
ALTER TABLE "customize_orders"
  ADD COLUMN IF NOT EXISTS "shipped_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "received_at" TIMESTAMP(3);
