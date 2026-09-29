ALTER TABLE "production_frame_reprints"
  ADD COLUMN "client_request_id" VARCHAR(80),
  ADD COLUMN "request_fingerprint" VARCHAR(64);

CREATE UNIQUE INDEX "production_frame_reprints_client_request_id_key"
  ON "production_frame_reprints"("client_request_id");
