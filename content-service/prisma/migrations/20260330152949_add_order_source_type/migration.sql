-- AlterTable
ALTER TABLE "customize_orders" ADD COLUMN     "collab_work_id" TEXT,
ADD COLUMN     "source_type" TEXT NOT NULL DEFAULT 'custom';
