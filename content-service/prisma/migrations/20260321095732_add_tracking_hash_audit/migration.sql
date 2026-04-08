-- AlterTable
ALTER TABLE "animations" ADD COLUMN     "fileHash" TEXT;

-- AlterTable
ALTER TABLE "customize_orders" ADD COLUMN     "trackingCompany" TEXT,
ADD COLUMN     "trackingNo" TEXT;

-- AlterTable
ALTER TABLE "operation_logs" ADD COLUMN     "action" TEXT,
ADD COLUMN     "targetId" TEXT;
