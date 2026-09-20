CREATE TABLE "cart_mutations" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "idempotency_key" VARCHAR(100) NOT NULL,
  "item_type" TEXT NOT NULL,
  "content_id" TEXT NOT NULL,
  "hardware_sku_id" TEXT NOT NULL,
  "cart_item_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "cart_mutations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cart_mutations_idempotency_key_key"
  ON "cart_mutations"("idempotency_key");

CREATE INDEX "cart_mutations_user_id_idx"
  ON "cart_mutations"("user_id");

CREATE INDEX "cart_mutations_cart_item_id_idx"
  ON "cart_mutations"("cart_item_id");

ALTER TABLE "cart_mutations"
  ADD CONSTRAINT "cart_mutations_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cart_mutations"
  ADD CONSTRAINT "cart_mutations_cart_item_id_fkey"
  FOREIGN KEY ("cart_item_id") REFERENCES "cart_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
