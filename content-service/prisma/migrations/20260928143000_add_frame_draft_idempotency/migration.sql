ALTER TABLE "frame_asset_drafts"
  ADD COLUMN "client_request_id" VARCHAR(80);

CREATE UNIQUE INDEX "frame_asset_drafts_client_request_id_key"
  ON "frame_asset_drafts"("client_request_id");
