ALTER TABLE "pre_orders"
  ADD COLUMN "checkout_snapshot" JSONB;

ALTER TABLE "sales_order_items"
  ADD COLUMN "base_unit_price" DECIMAL(10, 2),
  ADD COLUMN "price_adjustment" DECIMAL(10, 2),
  ADD COLUMN "product_no" VARCHAR(40),
  ADD COLUMN "fulfillment_mode" VARCHAR(24),
  ADD COLUMN "lead_time_days" INTEGER;
