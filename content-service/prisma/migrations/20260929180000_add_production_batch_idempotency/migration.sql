ALTER TABLE "production_batches"
  ADD COLUMN "client_request_id" VARCHAR(80),
  ADD COLUMN "request_fingerprint" VARCHAR(64);

UPDATE "production_batches"
SET
  "client_request_id" = 'legacy-' || "id",
  "request_fingerprint" = repeat('0', 64)
WHERE "client_request_id" IS NULL;

ALTER TABLE "production_batches"
  ALTER COLUMN "client_request_id" SET NOT NULL,
  ALTER COLUMN "request_fingerprint" SET NOT NULL;

CREATE UNIQUE INDEX "production_batches_client_request_id_key"
  ON "production_batches"("client_request_id");
