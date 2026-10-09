CREATE TABLE "inventory_material_mutations" (
  "id" TEXT NOT NULL,
  "client_request_id" VARCHAR(80) NOT NULL,
  "request_fingerprint" VARCHAR(64) NOT NULL,
  "action" VARCHAR(40) NOT NULL,
  "target_id" VARCHAR(100) NOT NULL,
  "operator_id" TEXT NOT NULL,
  "result_json" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_material_mutations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inventory_material_mutations_client_request_id_key"
  ON "inventory_material_mutations"("client_request_id");
CREATE INDEX "inventory_material_mutations_action_target_id_idx"
  ON "inventory_material_mutations"("action", "target_id");
CREATE INDEX "inventory_material_mutations_operator_id_idx"
  ON "inventory_material_mutations"("operator_id");
