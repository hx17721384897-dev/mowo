import { PrismaClient } from '@prisma/client'
import { animationTitleFromCustomProduct, createAnimationAssetVersion } from '../src/lib/animation-assets.js'

const prisma = new PrismaClient()
const requests = await prisma.customizationRequest.findMany({
  where: {
    animationAssetId: null,
    status: { in: ['FRAME_ACCEPTED', 'STYLE_SELECTED', 'CONFIRMED'] }
  },
  orderBy: { createdAt: 'asc' },
  include: { frameSelections: { orderBy: { version: 'desc' } } }
})

let created = 0
let skipped = 0
for (const request of requests) {
  const selection = request.mode === 'HUMAN'
    ? request.frameSelections.find(item => item.status === 'ACCEPTED')
    : null
  const frameKeys = selection?.selectedFrameKeys || request.selectedFrameKeys
  if (!Array.isArray(frameKeys) || frameKeys.length === 0) {
    skipped += 1
    console.warn(`SKIP ${request.requestNo || request.id}: no confirmed frames`)
    continue
  }
  const customProduct = request.customProductId
    ? await prisma.customProduct.findUnique({ where: { id: request.customProductId } })
    : null
  try {
    await prisma.$transaction(async tx => {
      const animation = await createAnimationAssetVersion(tx, {
        ownerUserId: request.userId,
        title: animationTitleFromCustomProduct(customProduct),
        sourceType: request.mode === 'HUMAN' ? 'STAFF_SCREENED' : 'SELF_SCREENED',
        sourceKey: selection
          ? `CUSTOMIZATION_FRAME_SELECTION:${selection.id}`
          : `CUSTOMIZATION_REQUEST:${request.id}:SELF_CONFIRMED`,
        sourceRequestId: request.id,
        sourceFrameSelectionId: selection?.id || null,
        sourceCustomProductId: request.customProductId,
        createdByUserId: selection?.createdByStaffId || request.userId,
        frameKeys,
        editorData: selection?.editorData || request.editorData || null
      })
      await tx.customizationRequest.update({
        where: { id: request.id },
        data: { animationAssetId: animation.asset.id, acceptedAnimationVersionId: animation.version.id }
      })
      if (request.customProductId) {
        await tx.customProduct.update({
          where: { id: request.customProductId },
          data: { animationAssetId: animation.asset.id, animationVersionId: animation.version.id, draftExpiresAt: null }
        })
      }
    })
    created += 1
    console.log(`CREATED ${request.requestNo || request.id}`)
  } catch (error) {
    skipped += 1
    console.warn(`SKIP ${request.requestNo || request.id}: ${error.message}`)
  }
}

console.log(`Animation asset backfill complete: created=${created}, skipped=${skipped}`)
await prisma.$disconnect()
