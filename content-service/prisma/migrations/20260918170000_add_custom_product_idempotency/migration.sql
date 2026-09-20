ALTER TABLE "custom_products"
  ADD COLUMN "client_draft_key" VARCHAR(80);

CREATE UNIQUE INDEX "custom_products_client_draft_key_key"
  ON "custom_products"("client_draft_key");
