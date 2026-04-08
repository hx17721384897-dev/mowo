-- AlterTable
ALTER TABLE "customize_orders" ADD COLUMN     "assignedTo" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "role" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "operation_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userRole" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "target" TEXT,
    "before" TEXT,
    "after" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operation_logs_pkey" PRIMARY KEY ("id")
);
