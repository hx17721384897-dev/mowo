/*
  Warnings:

  - You are about to drop the column `colorOptions` on the `machine_model_skus` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `machine_model_skus` table. All the data in the column will be lost.
  - You are about to drop the column `frameOptions` on the `machine_model_skus` table. All the data in the column will be lost.
  - You are about to drop the column `isActive` on the `machine_model_skus` table. All the data in the column will be lost.
  - You are about to drop the column `modelId` on the `machine_model_skus` table. All the data in the column will be lost.
  - You are about to drop the column `sortOrder` on the `machine_model_skus` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `machine_model_skus` table. All the data in the column will be lost.
  - You are about to alter the column `size` on the `machine_model_skus` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(20)`.
  - You are about to alter the column `material` on the `machine_model_skus` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(50)`.
  - A unique constraint covering the columns `[model_id,size,material,frame_count,color_id]` on the table `machine_model_skus` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `color_hex` to the `machine_model_skus` table without a default value. This is not possible if the table is not empty.
  - Added the required column `color_id` to the `machine_model_skus` table without a default value. This is not possible if the table is not empty.
  - Added the required column `color_name` to the `machine_model_skus` table without a default value. This is not possible if the table is not empty.
  - Added the required column `frame_count` to the `machine_model_skus` table without a default value. This is not possible if the table is not empty.
  - Added the required column `model_id` to the `machine_model_skus` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `machine_model_skus` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "machine_model_skus" DROP CONSTRAINT "machine_model_skus_modelId_fkey";

-- AlterTable
ALTER TABLE "machine_model_skus" DROP COLUMN "colorOptions",
DROP COLUMN "createdAt",
DROP COLUMN "frameOptions",
DROP COLUMN "isActive",
DROP COLUMN "modelId",
DROP COLUMN "sortOrder",
DROP COLUMN "updatedAt",
ADD COLUMN     "color_hex" VARCHAR(10) NOT NULL,
ADD COLUMN     "color_id" VARCHAR(50) NOT NULL,
ADD COLUMN     "color_name" VARCHAR(50) NOT NULL,
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "frame_count" INTEGER NOT NULL,
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "model_id" TEXT NOT NULL,
ADD COLUMN     "sort_order" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "size" SET DATA TYPE VARCHAR(20),
ALTER COLUMN "material" SET DATA TYPE VARCHAR(50);

-- CreateIndex
CREATE UNIQUE INDEX "machine_model_skus_model_id_size_material_frame_count_color_key" ON "machine_model_skus"("model_id", "size", "material", "frame_count", "color_id");

-- AddForeignKey
ALTER TABLE "machine_model_skus" ADD CONSTRAINT "machine_model_skus_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "machine_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
