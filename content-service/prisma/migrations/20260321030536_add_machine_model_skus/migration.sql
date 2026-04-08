-- CreateTable
CREATE TABLE "machine_model_skus" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "frameOptions" TEXT NOT NULL,
    "material" TEXT NOT NULL,
    "colorOptions" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "machine_model_skus_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "machine_model_skus" ADD CONSTRAINT "machine_model_skus_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "machine_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
