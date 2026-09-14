import { PrismaClient } from '@prisma/client'
import { linkCollabWorkToAnimation } from '../src/lib/collab-animation-asset.js'

const prisma = new PrismaClient()
let linked = 0
let skipped = 0

try {
  const works = await prisma.collabWork.findMany({
    where: { animationAssetId: null }, orderBy: { createdAt: 'asc' }
  })
  for (const work of works) {
    const product = await prisma.customProduct.findFirst({
      where: { userId: work.creatorId, animationFrames: work.animationFrames, animationAssetId: { not: null }, animationVersionId: { not: null } },
      select: { animationAssetId: true, animationVersionId: true }
    })
    const result = await prisma.$transaction(async tx => {
      const current = await tx.collabWork.findUnique({ where: { id: work.id } })
      if (!current || current.animationAssetId) return current
      return linkCollabWorkToAnimation(tx, current, product || {})
    })
    if (result?.animationAssetId) linked += 1
    else skipped += 1
  }
  console.log(`Collab animation asset backfill complete: linked ${linked}, skipped ${skipped}`)
} finally {
  await prisma.$disconnect()
}
