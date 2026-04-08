-- AlterTable
ALTER TABLE "creator_profiles" ADD COLUMN     "bullEnergy" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "bullEnergyScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "exclusiveExpiredAt" TIMESTAMP(3),
ADD COLUMN     "exclusiveSignedAt" TIMESTAMP(3),
ADD COLUMN     "isExclusive" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "collab_works" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "coverUrl" TEXT,
    "animationFrames" TEXT NOT NULL,
    "supportedSkus" TEXT NOT NULL,
    "isNewbieWork" BOOLEAN NOT NULL DEFAULT false,
    "newbieExpiredAt" TIMESTAMP(3),
    "activityId" TEXT,
    "isExclusiveWork" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "rejectReason" TEXT,
    "agreementSignedAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "revenueRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collab_works_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collab_orders" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "collabWorkId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "salePrice" DOUBLE PRECISION NOT NULL,
    "revenueRate" DOUBLE PRECISION NOT NULL,
    "revenueAmount" DOUBLE PRECISION NOT NULL,
    "settlementStatus" TEXT NOT NULL DEFAULT 'pending',
    "settlementWeek" TEXT,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collab_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collab_activities" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "revenueRate" DOUBLE PRECISION NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collab_activities_pkey" PRIMARY KEY ("id")
);
