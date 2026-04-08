/*
  Warnings:

  - You are about to drop the column `color_id` on the `machine_model_skus` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[model_id,size,material,frame_count,color_name]` on the table `machine_model_skus` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "machine_model_skus_model_id_size_material_frame_count_color_key";

-- AlterTable
ALTER TABLE "machine_model_skus" DROP COLUMN "color_id";

-- CreateIndex
CREATE UNIQUE INDEX "machine_model_skus_model_id_size_material_frame_count_color_key" ON "machine_model_skus"("model_id", "size", "material", "frame_count", "color_name");
