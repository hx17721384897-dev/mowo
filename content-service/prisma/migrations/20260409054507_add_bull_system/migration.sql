-- CreateTable
CREATE TABLE "platform_configs" (
    "id" TEXT NOT NULL,
    "config_key" VARCHAR(100) NOT NULL,
    "config_value" VARCHAR(500) NOT NULL,
    "value_type" VARCHAR(20) NOT NULL DEFAULT 'number',
    "description" VARCHAR(200),
    "group_name" VARCHAR(50) NOT NULL DEFAULT 'bull',
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bull_scores" (
    "id" TEXT NOT NULL,
    "creator_id" TEXT NOT NULL,
    "activity_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "social_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "conversion_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monthly_posts" INTEGER NOT NULL DEFAULT 0,
    "monthly_orders" INTEGER NOT NULL DEFAULT 0,
    "total_views" INTEGER NOT NULL DEFAULT 0,
    "total_likes" INTEGER NOT NULL DEFAULT 0,
    "social_manual_mod" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "score_date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bull_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bull_score_logs" (
    "id" TEXT NOT NULL,
    "creator_id" TEXT NOT NULL,
    "change_type" VARCHAR(20) NOT NULL,
    "level_before" INTEGER NOT NULL,
    "level_after" INTEGER NOT NULL,
    "score_before" DOUBLE PRECISION NOT NULL,
    "score_after" DOUBLE PRECISION NOT NULL,
    "reason" VARCHAR(200),
    "operator_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bull_score_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creator_referral_links" (
    "id" TEXT NOT NULL,
    "creator_id" TEXT NOT NULL,
    "link_code" VARCHAR(20) NOT NULL,
    "total_clicks" INTEGER NOT NULL DEFAULT 0,
    "total_orders" INTEGER NOT NULL DEFAULT 0,
    "total_revenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creator_referral_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_clicks" (
    "id" TEXT NOT NULL,
    "link_id" TEXT NOT NULL,
    "creator_id" TEXT NOT NULL,
    "ip" VARCHAR(50),
    "user_agent" TEXT,
    "referrer" VARCHAR(500),
    "order_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_configs_config_key_key" ON "platform_configs"("config_key");

-- CreateIndex
CREATE INDEX "platform_configs_group_name_idx" ON "platform_configs"("group_name");

-- CreateIndex
CREATE INDEX "bull_scores_creator_id_idx" ON "bull_scores"("creator_id");

-- CreateIndex
CREATE INDEX "bull_scores_score_date_idx" ON "bull_scores"("score_date");

-- CreateIndex
CREATE UNIQUE INDEX "bull_scores_creator_id_score_date_key" ON "bull_scores"("creator_id", "score_date");

-- CreateIndex
CREATE INDEX "bull_score_logs_creator_id_idx" ON "bull_score_logs"("creator_id");

-- CreateIndex
CREATE INDEX "bull_score_logs_created_at_idx" ON "bull_score_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "creator_referral_links_creator_id_key" ON "creator_referral_links"("creator_id");

-- CreateIndex
CREATE UNIQUE INDEX "creator_referral_links_link_code_key" ON "creator_referral_links"("link_code");

-- CreateIndex
CREATE INDEX "referral_clicks_link_id_idx" ON "referral_clicks"("link_id");

-- CreateIndex
CREATE INDEX "referral_clicks_creator_id_idx" ON "referral_clicks"("creator_id");

-- CreateIndex
CREATE INDEX "referral_clicks_created_at_idx" ON "referral_clicks"("created_at");

-- AddForeignKey
ALTER TABLE "platform_configs" ADD CONSTRAINT "platform_configs_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bull_scores" ADD CONSTRAINT "bull_scores_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bull_score_logs" ADD CONSTRAINT "bull_score_logs_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_referral_links" ADD CONSTRAINT "creator_referral_links_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_clicks" ADD CONSTRAINT "referral_clicks_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "creator_referral_links"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
