ALTER TABLE "sales_orders"
  ADD COLUMN "fulfillment_hold_minutes" INTEGER,
  ADD COLUMN "earliest_production_at" TIMESTAMP(3);

ALTER TABLE "sales_orders"
  ADD CONSTRAINT "sales_orders_fulfillment_hold_minutes_check"
  CHECK ("fulfillment_hold_minutes" IS NULL OR "fulfillment_hold_minutes" BETWEEN 0 AND 10080);

INSERT INTO "platform_configs" (
  "id", "config_key", "config_value", "value_type", "description", "group_name", "updated_at", "created_at"
) VALUES (
  'fulfillment-hold-minutes-default', 'fulfillment_hold_minutes', '60', 'number',
  '付款后暂缓进入生产批次的分钟数，仅影响新付款订单', 'orders', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT ("config_key") DO NOTHING;
