import crypto from 'crypto'
import { createAnimationAssetNo } from './animation-assets.js'

function keys(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string' && item.length <= 200000).slice(0, 50) : []
  } catch {
    return []
  }
}

function statusFields(status) {
  if (status === 'approved') return { assetType: 'COLLAB', usageType: 'COLLAB_SALE', collabStatus: 'AUTHORIZED', authorizationStatus: 'AUTHORIZED' }
  if (status === 'rejected') return { collabStatus: 'STOPPED' }
  return { collabStatus: 'PENDING' }
}

export async function linkCollabWorkToAnimation(tx, work, options = {}) {
  if (work.isRevision && work.originalWorkId) {
    const original = await tx.collabWork.findUnique({ where: { id: work.originalWorkId }, select: { animationAssetId: true, animationVersionId: true } })
    if (original?.animationAssetId && original.animationVersionId) {
      return tx.collabWork.update({ where: { id: work.id }, data: {
        animationAssetId: original.animationAssetId, animationVersionId: original.animationVersionId
      } })
    }
  }

  if (options.animationAssetId && options.animationVersionId) {
    const version = await tx.animationAssetVersion.findFirst({ where: {
      id: options.animationVersionId, assetId: options.animationAssetId,
      asset: { ownerUserId: work.creatorId }
    } })
    if (version) {
      await tx.animationAsset.update({ where: { id: options.animationAssetId }, data: statusFields(work.status) })
      return tx.collabWork.update({ where: { id: work.id }, data: {
        animationAssetId: options.animationAssetId, animationVersionId: options.animationVersionId
      } })
    }
  }

  const frameKeys = keys(work.animationFrames)
  if (!frameKeys.length) return work
  const asset = await tx.animationAsset.create({ data: {
    assetNo: await createAnimationAssetNo(tx), ownerUserId: work.creatorId,
    title: work.title || '未命名动画', sourceType: 'STAFF_CREATED', sourceChannel: 'CREATOR_SUBMISSION',
    usageType: 'COLLAB_SALE', assetType: 'COLLAB', status: work.status === 'rejected' ? 'ARCHIVED' : 'ACTIVE',
    collabStatus: statusFields(work.status).collabStatus,
    rightsHolderType: 'CREATOR', authorizationStatus: work.status === 'approved' ? 'AUTHORIZED' : 'PENDING',
    currentVersionNo: 1
  } })
  const version = await tx.animationAssetVersion.create({ data: {
    assetId: asset.id, versionNo: 1, sourceKey: `COLLAB_WORK:${work.id}:INITIAL`, sourceType: 'CREATOR_SUBMISSION',
    frameKeys, baseFrameCount: frameKeys.length,
    manifestHash: crypto.createHash('sha256').update(JSON.stringify(frameKeys)).digest('hex')
  } })
  return tx.collabWork.update({ where: { id: work.id }, data: {
    animationAssetId: asset.id, animationVersionId: version.id
  } })
}

export async function updateCollabAssetStatus(tx, work, status) {
  if (!work.animationAssetId) return
  if (status === 'approved') {
    await tx.animationAsset.update({ where: { id: work.animationAssetId }, data: statusFields(status) })
    return
  }
  const otherActive = await tx.collabWork.count({ where: {
    animationAssetId: work.animationAssetId, id: { not: work.id }, status: { in: ['pending', 'approved'] }
  } })
  if (otherActive) return
  const asset = await tx.animationAsset.findUnique({ where: { id: work.animationAssetId } })
  if (!asset) return
  await tx.animationAsset.update({ where: { id: asset.id }, data: asset.sourceChannel === 'CREATOR_SUBMISSION'
    ? { status: 'ARCHIVED', archivedAt: new Date(), collabStatus: 'STOPPED' }
    : { collabStatus: 'NONE' }
  })
}
