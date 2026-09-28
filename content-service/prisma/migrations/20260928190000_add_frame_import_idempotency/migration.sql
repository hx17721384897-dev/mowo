ALTER TABLE "frame_asset_import_batches"
  ADD COLUMN "client_request_id" VARCHAR(80),
  ADD COLUMN "request_fingerprint" VARCHAR(64);

CREATE UNIQUE INDEX "frame_asset_import_batches_client_request_id_key"
  ON "frame_asset_import_batches"("client_request_id");
