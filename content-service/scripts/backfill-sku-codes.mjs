import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

try {
  const skus = await prisma.machineModelSku.findMany({ orderBy: { createdAt: 'asc' } })
  let updated = 0
  await prisma.$transaction(async tx => {
    for (const sku of skus) {
      if (sku.skuCode) continue
      const skuCode = sku.skuBarcode || `MOWO-SKU-${sku.id.slice(0, 8).toUpperCase()}`
      await tx.machineModelSku.update({ where: { id: sku.id }, data: { skuCode } })
      await tx.salesOrderItem.updateMany({ where: { skuId: sku.id, skuCode: null }, data: { skuCode } })
      await tx.batchItem.updateMany({ where: { skuId: sku.id, skuCode: null }, data: { skuCode } })
      updated += 1
    }
  })
  console.log(`SKU code backfill complete: ${updated} SKU(s) updated`)
} finally {
  await prisma.$disconnect()
}
