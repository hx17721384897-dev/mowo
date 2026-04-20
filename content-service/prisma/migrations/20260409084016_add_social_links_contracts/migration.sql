-- CreateTable
CREATE TABLE "creator_social_links" (
    "id" TEXT NOT NULL,
    "creator_id" TEXT NOT NULL,
    "platform" VARCHAR(20) NOT NULL,
    "video_url" VARCHAR(500) NOT NULL,
    "video_title" VARCHAR(200),
    "description" TEXT,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "like_count" INTEGER NOT NULL DEFAULT 0,
    "last_fetched_at" TIMESTAMP(3),
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "brand_mentioned" BOOLEAN NOT NULL DEFAULT false,
    "manual_mod" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "review_note" VARCHAR(200),
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creator_social_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creator_contracts" (
    "id" TEXT NOT NULL,
    "creator_id" TEXT NOT NULL,
    "creator_name" VARCHAR(100) NOT NULL,
    "contract_type" VARCHAR(20) NOT NULL,
    "revenue_rate" DOUBLE PRECISION,
    "guarantee_amount" DOUBLE PRECISION,
    "buyout_amount" DOUBLE PRECISION,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3),
    "terms" TEXT,
    "attachments" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "settlement_logs" TEXT,
    "created_by" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creator_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "creator_social_links_creator_id_idx" ON "creator_social_links"("creator_id");

-- CreateIndex
CREATE INDEX "creator_social_links_status_idx" ON "creator_social_links"("status");

-- CreateIndex
CREATE INDEX "creator_contracts_creator_id_idx" ON "creator_contracts"("creator_id");

-- CreateIndex
CREATE INDEX "creator_contracts_status_idx" ON "creator_contracts"("status");

-- AddForeignKey
ALTER TABLE "creator_social_links" ADD CONSTRAINT "creator_social_links_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_contracts" ADD CONSTRAINT "creator_contracts_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_contracts" ADD CONSTRAINT "creator_contracts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
