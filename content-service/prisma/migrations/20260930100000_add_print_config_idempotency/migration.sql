ALTER TABLE "print_cut_groups"
  ADD COLUMN "client_request_id" VARCHAR(80),
  ADD COLUMN "request_fingerprint" VARCHAR(64);

ALTER TABLE "print_template_versions"
  ADD COLUMN "client_request_id" VARCHAR(80),
  ADD COLUMN "request_fingerprint" VARCHAR(64);

CREATE UNIQUE INDEX "print_cut_groups_client_request_id_key"
  ON "print_cut_groups"("client_request_id");

CREATE UNIQUE INDEX "print_template_versions_client_request_id_key"
  ON "print_template_versions"("client_request_id");
