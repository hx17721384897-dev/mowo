/*
  Warnings:

  - You are about to drop the column `fileHash` on the `animations` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `collab_activities` table. All the data in the column will be lost.
  - You are about to drop the column `createdBy` on the `collab_activities` table. All the data in the column will be lost.
  - You are about to drop the column `endAt` on the `collab_activities` table. All the data in the column will be lost.
  - You are about to drop the column `isActive` on the `collab_activities` table. All the data in the column will be lost.
  - You are about to drop the column `revenueRate` on the `collab_activities` table. All the data in the column will be lost.
  - You are about to drop the column `startAt` on the `collab_activities` table. All the data in the column will be lost.
  - You are about to alter the column `size` on the `collab_frame_packs` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(20)`.
  - You are about to alter the column `oss_path` on the `collab_frame_packs` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(500)`.
  - You are about to alter the column `local_cache_path` on the `collab_frame_packs` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(500)`.
  - You are about to alter the column `stock_type` on the `collab_frame_packs` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(20)`.
  - You are about to drop the column `collabWorkId` on the `collab_orders` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `collab_orders` table. All the data in the column will be lost.
  - You are about to drop the column `creatorId` on the `collab_orders` table. All the data in the column will be lost.
  - You are about to drop the column `orderId` on the `collab_orders` table. All the data in the column will be lost.
  - You are about to drop the column `revenueAmount` on the `collab_orders` table. All the data in the column will be lost.
  - You are about to drop the column `revenueRate` on the `collab_orders` table. All the data in the column will be lost.
  - You are about to drop the column `salePrice` on the `collab_orders` table. All the data in the column will be lost.
  - You are about to drop the column `settledAt` on the `collab_orders` table. All the data in the column will be lost.
  - You are about to drop the column `settlementStatus` on the `collab_orders` table. All the data in the column will be lost.
  - You are about to drop the column `settlementWeek` on the `collab_orders` table. All the data in the column will be lost.
  - You are about to drop the column `activityId` on the `collab_works` table. All the data in the column will be lost.
  - You are about to drop the column `agreementSignedAt` on the `collab_works` table. All the data in the column will be lost.
  - You are about to drop the column `animationFrames` on the `collab_works` table. All the data in the column will be lost.
  - You are about to drop the column `approvedAt` on the `collab_works` table. All the data in the column will be lost.
  - You are about to drop the column `approvedBy` on the `collab_works` table. All the data in the column will be lost.
  - You are about to drop the column `coverUrl` on the `collab_works` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `collab_works` table. All the data in the column will be lost.
  - You are about to drop the column `creatorId` on the `collab_works` table. All the data in the column will be lost.
  - You are about to drop the column `isExclusiveWork` on the `collab_works` table. All the data in the column will be lost.
  - You are about to drop the column `isNewbieWork` on the `collab_works` table. All the data in the column will be lost.
  - You are about to drop the column `newbieExpiredAt` on the `collab_works` table. All the data in the column will be lost.
  - You are about to drop the column `orderNo` on the `collab_works` table. All the data in the column will be lost.
  - You are about to drop the column `rejectReason` on the `collab_works` table. All the data in the column will be lost.
  - You are about to drop the column `revenueRate` on the `collab_works` table. All the data in the column will be lost.
  - You are about to drop the column `supportedSkus` on the `collab_works` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `collab_works` table. All the data in the column will be lost.
  - You are about to alter the column `frame_pack_oss_path` on the `collab_works` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(500)`.
  - You are about to alter the column `type` on the `contact_submissions` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(20)`.
  - You are about to alter the column `status` on the `contact_submissions` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(20)`.
  - You are about to drop the column `bullEnergy` on the `creator_profiles` table. All the data in the column will be lost.
  - You are about to drop the column `bullEnergyScore` on the `creator_profiles` table. All the data in the column will be lost.
  - You are about to drop the column `exclusiveExpiredAt` on the `creator_profiles` table. All the data in the column will be lost.
  - You are about to drop the column `exclusiveSignedAt` on the `creator_profiles` table. All the data in the column will be lost.
  - You are about to drop the column `isExclusive` on the `creator_profiles` table. All the data in the column will be lost.
  - You are about to drop the column `assignedTo` on the `customize_orders` table. All the data in the column will be lost.
  - You are about to drop the column `colorName` on the `customize_orders` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `customize_orders` table. All the data in the column will be lost.
  - You are about to drop the column `crmebOrderId` on the `customize_orders` table. All the data in the column will be lost.
  - You are about to drop the column `frameCount` on the `customize_orders` table. All the data in the column will be lost.
  - You are about to drop the column `frameUrls` on the `customize_orders` table. All the data in the column will be lost.
  - You are about to drop the column `modelId` on the `customize_orders` table. All the data in the column will be lost.
  - You are about to drop the column `modelName` on the `customize_orders` table. All the data in the column will be lost.
  - You are about to drop the column `ossPath` on the `customize_orders` table. All the data in the column will be lost.
  - You are about to drop the column `skuId` on the `customize_orders` table. All the data in the column will be lost.
  - You are about to drop the column `trackingCompany` on the `customize_orders` table. All the data in the column will be lost.
  - You are about to drop the column `trackingNo` on the `customize_orders` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `customize_orders` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `customize_orders` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `operation_logs` table. All the data in the column will be lost.
  - You are about to drop the column `targetId` on the `operation_logs` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `operation_logs` table. All the data in the column will be lost.
  - You are about to drop the column `userRole` on the `operation_logs` table. All the data in the column will be lost.
  - Added the required column `created_by` to the `collab_activities` table without a default value. This is not possible if the table is not empty.
  - Added the required column `end_at` to the `collab_activities` table without a default value. This is not possible if the table is not empty.
  - Added the required column `revenue_rate` to the `collab_activities` table without a default value. This is not possible if the table is not empty.
  - Added the required column `start_at` to the `collab_activities` table without a default value. This is not possible if the table is not empty.
  - Added the required column `collab_work_id` to the `collab_orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `creator_id` to the `collab_orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `order_id` to the `collab_orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `revenue_amount` to the `collab_orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `revenue_rate` to the `collab_orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sale_price` to the `collab_orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `agreement_signed_at` to the `collab_works` table without a default value. This is not possible if the table is not empty.
  - Added the required column `animation_frames` to the `collab_works` table without a default value. This is not possible if the table is not empty.
  - Added the required column `creator_id` to the `collab_works` table without a default value. This is not possible if the table is not empty.
  - Added the required column `order_no` to the `collab_works` table without a default value. This is not possible if the table is not empty.
  - Added the required column `supported_skus` to the `collab_works` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `collab_works` table without a default value. This is not possible if the table is not empty.
  - Added the required column `color_name` to the `customize_orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `frame_count` to the `customize_orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `frame_urls` to the `customize_orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `model_id` to the `customize_orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `model_name` to the `customize_orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `oss_path` to the `customize_orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sku_id` to the `customize_orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `customize_orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `user_id` to the `customize_orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `user_id` to the `operation_logs` table without a default value. This is not possible if the table is not empty.
  - Added the required column `user_role` to the `operation_logs` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "customize_orders" DROP CONSTRAINT "customize_orders_userId_fkey";

-- AlterTable
ALTER TABLE "animations" DROP COLUMN "fileHash",
ADD COLUMN     "file_hash" TEXT;

-- AlterTable
ALTER TABLE "collab_activities" DROP COLUMN "createdAt",
DROP COLUMN "createdBy",
DROP COLUMN "endAt",
DROP COLUMN "isActive",
DROP COLUMN "revenueRate",
DROP COLUMN "startAt",
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "created_by" TEXT NOT NULL,
ADD COLUMN     "end_at" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "revenue_rate" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "start_at" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "collab_frame_packs" ALTER COLUMN "size" SET DATA TYPE VARCHAR(20),
ALTER COLUMN "oss_path" SET DATA TYPE VARCHAR(500),
ALTER COLUMN "local_cache_path" SET DATA TYPE VARCHAR(500),
ALTER COLUMN "stock_type" SET DATA TYPE VARCHAR(20);

-- AlterTable
ALTER TABLE "collab_orders" DROP COLUMN "collabWorkId",
DROP COLUMN "createdAt",
DROP COLUMN "creatorId",
DROP COLUMN "orderId",
DROP COLUMN "revenueAmount",
DROP COLUMN "revenueRate",
DROP COLUMN "salePrice",
DROP COLUMN "settledAt",
DROP COLUMN "settlementStatus",
DROP COLUMN "settlementWeek",
ADD COLUMN     "collab_work_id" TEXT NOT NULL,
ADD COLUMN     "cooling_end_at" TIMESTAMP(3),
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "creator_id" TEXT NOT NULL,
ADD COLUMN     "order_id" TEXT NOT NULL,
ADD COLUMN     "payout_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "reserve_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "reserve_rate" DOUBLE PRECISION NOT NULL DEFAULT 0.15,
ADD COLUMN     "revenue_amount" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "revenue_rate" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "revenue_status" VARCHAR(20) NOT NULL DEFAULT 'estimated',
ADD COLUMN     "sale_price" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "settled_at" TIMESTAMP(3),
ADD COLUMN     "settlement_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
ADD COLUMN     "settlement_week" VARCHAR(10);

-- AlterTable
ALTER TABLE "collab_works" DROP COLUMN "activityId",
DROP COLUMN "agreementSignedAt",
DROP COLUMN "animationFrames",
DROP COLUMN "approvedAt",
DROP COLUMN "approvedBy",
DROP COLUMN "coverUrl",
DROP COLUMN "createdAt",
DROP COLUMN "creatorId",
DROP COLUMN "isExclusiveWork",
DROP COLUMN "isNewbieWork",
DROP COLUMN "newbieExpiredAt",
DROP COLUMN "orderNo",
DROP COLUMN "rejectReason",
DROP COLUMN "revenueRate",
DROP COLUMN "supportedSkus",
DROP COLUMN "updatedAt",
ADD COLUMN     "activity_id" TEXT,
ADD COLUMN     "agreement_signed_at" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "animation_frames" TEXT NOT NULL,
ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by" TEXT,
ADD COLUMN     "cover_url" TEXT,
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "creator_id" TEXT NOT NULL,
ADD COLUMN     "is_exclusive_work" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_newbie_work" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "newbie_expired_at" TIMESTAMP(3),
ADD COLUMN     "order_no" TEXT NOT NULL,
ADD COLUMN     "reject_reason" TEXT,
ADD COLUMN     "revenue_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "supported_skus" TEXT NOT NULL,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "frame_pack_oss_path" SET DATA TYPE VARCHAR(500);

-- AlterTable
ALTER TABLE "contact_submissions" ADD COLUMN     "submitter_user_id" TEXT,
ALTER COLUMN "type" SET DATA TYPE VARCHAR(20),
ALTER COLUMN "status" SET DATA TYPE VARCHAR(20);

-- AlterTable
ALTER TABLE "creator_profiles" DROP COLUMN "bullEnergy",
DROP COLUMN "bullEnergyScore",
DROP COLUMN "exclusiveExpiredAt",
DROP COLUMN "exclusiveSignedAt",
DROP COLUMN "isExclusive",
ADD COLUMN     "bull_coefficient" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
ADD COLUMN     "bull_level" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "bull_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "exclusive_expired_at" TIMESTAMP(3),
ADD COLUMN     "exclusive_signed_at" TIMESTAMP(3),
ADD COLUMN     "is_exclusive" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "customize_orders" DROP COLUMN "assignedTo",
DROP COLUMN "colorName",
DROP COLUMN "createdAt",
DROP COLUMN "crmebOrderId",
DROP COLUMN "frameCount",
DROP COLUMN "frameUrls",
DROP COLUMN "modelId",
DROP COLUMN "modelName",
DROP COLUMN "ossPath",
DROP COLUMN "skuId",
DROP COLUMN "trackingCompany",
DROP COLUMN "trackingNo",
DROP COLUMN "updatedAt",
DROP COLUMN "userId",
ADD COLUMN     "assigned_to" TEXT,
ADD COLUMN     "color_name" TEXT NOT NULL,
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "crmeb_order_id" TEXT,
ADD COLUMN     "frame_count" INTEGER NOT NULL,
ADD COLUMN     "frame_urls" TEXT NOT NULL,
ADD COLUMN     "model_id" TEXT NOT NULL,
ADD COLUMN     "model_name" TEXT NOT NULL,
ADD COLUMN     "oss_path" TEXT NOT NULL,
ADD COLUMN     "sku_id" TEXT NOT NULL,
ADD COLUMN     "tracking_company" TEXT,
ADD COLUMN     "tracking_no" TEXT,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "user_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "operation_logs" DROP COLUMN "createdAt",
DROP COLUMN "targetId",
DROP COLUMN "userId",
DROP COLUMN "userRole",
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "target_id" TEXT,
ADD COLUMN     "user_id" TEXT NOT NULL,
ADD COLUMN     "user_role" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "withdrawal_requests" ADD COLUMN     "flex_status" VARCHAR(20),
ADD COLUMN     "flex_task_id" VARCHAR(100);

-- CreateTable
CREATE TABLE "creator_reserves" (
    "id" TEXT NOT NULL,
    "creator_id" TEXT NOT NULL,
    "total_reserved" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "frozen_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "releasable_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "released_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "next_release_at" TIMESTAMP(3),
    "next_release_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creator_reserves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reserve_logs" (
    "id" TEXT NOT NULL,
    "creator_id" TEXT NOT NULL,
    "reserve_id" TEXT NOT NULL,
    "collab_order_id" TEXT,
    "action_type" VARCHAR(20) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "balance_after" DOUBLE PRECISION NOT NULL,
    "release_at" TIMESTAMP(3),
    "note" VARCHAR(200),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reserve_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_records" (
    "id" TEXT NOT NULL,
    "settlement_week" VARCHAR(10) NOT NULL,
    "creator_id" TEXT NOT NULL,
    "order_count" INTEGER NOT NULL,
    "total_revenue" DOUBLE PRECISION NOT NULL,
    "reserve_deducted" DOUBLE PRECISION NOT NULL,
    "payout_amount" DOUBLE PRECISION NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "settled_by" TEXT,
    "settled_at" TIMESTAMP(3),
    "note" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlement_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "creator_reserves_creator_id_key" ON "creator_reserves"("creator_id");

-- CreateIndex
CREATE INDEX "reserve_logs_creator_id_idx" ON "reserve_logs"("creator_id");

-- CreateIndex
CREATE INDEX "reserve_logs_reserve_id_idx" ON "reserve_logs"("reserve_id");

-- CreateIndex
CREATE INDEX "reserve_logs_release_at_idx" ON "reserve_logs"("release_at");

-- CreateIndex
CREATE INDEX "settlement_records_settlement_week_idx" ON "settlement_records"("settlement_week");

-- CreateIndex
CREATE INDEX "settlement_records_creator_id_idx" ON "settlement_records"("creator_id");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_records_settlement_week_creator_id_key" ON "settlement_records"("settlement_week", "creator_id");

-- AddForeignKey
ALTER TABLE "customize_orders" ADD CONSTRAINT "customize_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collab_orders" ADD CONSTRAINT "collab_orders_collab_work_id_fkey" FOREIGN KEY ("collab_work_id") REFERENCES "collab_works"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collab_frame_packs" ADD CONSTRAINT "collab_frame_packs_collab_work_id_fkey" FOREIGN KEY ("collab_work_id") REFERENCES "collab_works"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_reserves" ADD CONSTRAINT "creator_reserves_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserve_logs" ADD CONSTRAINT "reserve_logs_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserve_logs" ADD CONSTRAINT "reserve_logs_reserve_id_fkey" FOREIGN KEY ("reserve_id") REFERENCES "creator_reserves"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserve_logs" ADD CONSTRAINT "reserve_logs_collab_order_id_fkey" FOREIGN KEY ("collab_order_id") REFERENCES "collab_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_records" ADD CONSTRAINT "settlement_records_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_records" ADD CONSTRAINT "settlement_records_settled_by_fkey" FOREIGN KEY ("settled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
