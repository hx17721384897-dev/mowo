-- AlterTable
ALTER TABLE "customize_orders" ADD COLUMN     "batch_id" TEXT,
ADD COLUMN     "receiver_address" TEXT,
ADD COLUMN     "receiver_city" TEXT,
ADD COLUMN     "receiver_name" TEXT,
ADD COLUMN     "receiver_phone" TEXT;

-- CreateTable
CREATE TABLE "shipping_batches" (
    "id" TEXT NOT NULL,
    "tracking_no" TEXT,
    "tracking_company" TEXT,
    "receiver_name" TEXT NOT NULL,
    "receiver_phone" TEXT NOT NULL,
    "receiver_address" TEXT NOT NULL,
    "receiver_city" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "order_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_batches_pkey" PRIMARY KEY ("id")
);
