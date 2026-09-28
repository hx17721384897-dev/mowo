CREATE TABLE "collab_frame_pack_mutations" (
  "id" TEXT NOT NULL,
  "client_request_id" VARCHAR(80) NOT NULL,
  "request_fingerprint" VARCHAR(64) NOT NULL,
  "collab_work_id" TEXT NOT NULL,
  "size" VARCHAR(20) NOT NULL,
  "operator_id" TEXT NOT NULL,
  "stock_type" VARCHAR(20) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "result_stock" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "collab_frame_pack_mutations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "collab_frame_pack_mutations_collab_work_id_fkey"
    FOREIGN KEY ("collab_work_id") REFERENCES "collab_works"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "collab_frame_pack_mutations_client_request_id_key"
  ON "collab_frame_pack_mutations"("client_request_id");
CREATE INDEX "collab_frame_pack_mutations_collab_work_id_created_at_idx"
  ON "collab_frame_pack_mutations"("collab_work_id", "created_at");
CREATE INDEX "collab_frame_pack_mutations_operator_id_created_at_idx"
  ON "collab_frame_pack_mutations"("operator_id", "created_at");
