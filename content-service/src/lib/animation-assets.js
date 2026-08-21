import crypto from 'crypto'

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

function shanghaiDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now).replaceAll('-', '')
}

function randomCode(length = 6) {
  const bytes = crypto.randomBytes(length)
  return [...bytes].map(value => CODE_ALPHABET[value % CODE_ALPHABET.length]).join('')
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function animationTitleFromCustomProduct(customProduct) {
  if (!customProduct?.configJson) return '未命名动画'
  try {
    const config = typeof customProduct.configJson === 'string'
      ? JSON.parse(customProduct.configJson)
      : customProduct.configJson
    const title = String(config?.animName || '').trim()
    return title ? title.slice(0, 200) : '未命名动画'
  } catch {
    return '未命名动画'
  }
}

export async function createAnimationAssetNo(prisma) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const assetNo = `ANM-${shanghaiDate()}-${randomCode()}`
    const exists = await prisma.animationAsset.findUnique({ where: { assetNo }, select: { id: true } })
    if (!exists) return assetNo
  }
  throw new Error('暂时无法生成动画编号，请稍后重试')
}

// Must run inside the same transaction that confirms the customization result.
export async function createAnimationAssetVersion(tx, input) {
  const sourceKey = String(input.sourceKey || '').trim()
  const frameKeys = Array.isArray(input.frameKeys)
    ? [...new Set(input.frameKeys.filter(key => typeof key === 'string' && key.startsWith('private/')))]
    : []
  if (!sourceKey || frameKeys.length === 0 || frameKeys.length > 50) {
    throw new Error('动画版本来源或帧图无效')
  }

  const existing = await tx.animationAssetVersion.findUnique({
    where: { sourceKey }, include: { asset: true }
  })
  if (existing) {
    if (existing.asset.ownerUserId !== input.ownerUserId) throw new Error('动画版本来源冲突')
    return { asset: existing.asset, version: existing, reused: true }
  }

  const files = await tx.privateFile.findMany({
    where: {
      objectKey: { in: frameKeys }, ownerUserId: input.ownerUserId,
      status: 'READY', deletedAt: null
    },
    select: { objectKey: true, sha256: true }
  })
  if (files.length !== frameKeys.length) throw new Error('动画核心帧不完整或不属于当前用户')
  const fileMap = new Map(files.map(file => [file.objectKey, file]))
  const manifest = frameKeys.map(key => ({ key, sha256: fileMap.get(key)?.sha256 || null }))
  const manifestHash = crypto.createHash('sha256')
    .update(stableJson({ frames: manifest, editorData: input.editorData || null }))
    .digest('hex')

  let asset = input.animationAssetId
    ? await tx.animationAsset.findUnique({ where: { id: input.animationAssetId } })
    : null
  if (asset && asset.ownerUserId !== input.ownerUserId) throw new Error('动画资产不属于当前用户')
  if (!asset) {
    asset = await tx.animationAsset.create({ data: {
      assetNo: await createAnimationAssetNo(tx),
      ownerUserId: input.ownerUserId,
      title: String(input.title || '未命名动画').trim().slice(0, 200) || '未命名动画',
      sourceType: input.sourceType,
      currentVersionNo: 0
    } })
  }

  const versionNo = asset.currentVersionNo + 1
  const version = await tx.animationAssetVersion.create({ data: {
    assetId: asset.id,
    versionNo,
    sourceKey,
    sourceType: input.sourceType,
    sourceRequestId: input.sourceRequestId || null,
    sourceFrameSelectionId: input.sourceFrameSelectionId || null,
    sourceCustomProductId: input.sourceCustomProductId || null,
    createdByUserId: input.createdByUserId || null,
    frameKeys,
    baseFrameCount: frameKeys.length,
    editorData: input.editorData || undefined,
    manifestHash
  } })
  asset = await tx.animationAsset.update({
    where: { id: asset.id },
    data: { currentVersionNo: versionNo, status: 'ACTIVE', frontDeletedAt: null }
  })
  return { asset, version, reused: false }
}
