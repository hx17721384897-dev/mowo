-- CreateTable
CREATE TABLE "machine_models" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ratios" TEXT NOT NULL,
    "frameOptions" TEXT NOT NULL,
    "sizes" TEXT NOT NULL,
    "previewImage" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "machine_models_pkey" PRIMARY KEY ("id")
);
