-- CreateTable
CREATE TABLE "customize_orders" (
    "id" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "frameCount" INTEGER NOT NULL,
    "size" TEXT NOT NULL,
    "material" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "colorName" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "ossPath" TEXT NOT NULL,
    "frameUrls" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "crmebOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customize_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customize_orders_orderNo_key" ON "customize_orders"("orderNo");

-- AddForeignKey
ALTER TABLE "customize_orders" ADD CONSTRAINT "customize_orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
