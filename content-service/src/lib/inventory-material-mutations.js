import crypto from 'node:crypto'

export class InventoryMutationConflictError extends Error {
  constructor() {
    super('本次请求标识已用于其他库存操作，请刷新后重试')
    this.code = 'IDEMPOTENCY_KEY_CONFLICT'
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, canonical(value[key])])
    )
  }
  return value
}

export function inventoryMutationRequest(body, action, targetId, operatorId) {
  const clientRequestId = String(body?.clientRequestId || '').trim()
  if (!clientRequestId || clientRequestId.length > 80) {
    const error = new Error('缺少库存操作请求标识，请重新打开操作面板')
    error.code = 'MISSING_IDEMPOTENCY_KEY'
    throw error
  }
  const payload = { ...body }
  delete payload.clientRequestId
  return {
    clientRequestId,
    action,
    targetId,
    operatorId,
    requestFingerprint: crypto
      .createHash('sha256')
      .update(JSON.stringify(canonical({ action, targetId, payload })))
      .digest('hex')
  }
}

function validate(row, request) {
  if (
    row.action !== request.action ||
    row.targetId !== request.targetId ||
    row.operatorId !== request.operatorId ||
    row.requestFingerprint !== request.requestFingerprint
  ) throw new InventoryMutationConflictError()
  return JSON.parse(row.resultJson)
}

export async function runInventoryMutation(prisma, request, work) {
  const replay = await replayInventoryMutation(prisma, request)
  if (replay) return replay

  try {
    const result = await prisma.$transaction(async tx => {
      await tx.inventoryMaterialMutation.create({
        data: { ...request, resultJson: '{}' }
      })
      const value = await work(tx)
      await tx.inventoryMaterialMutation.update({
        where: { clientRequestId: request.clientRequestId },
        data: { resultJson: JSON.stringify(value) }
      })
      return value
    })
    return { reused: false, result }
  } catch (error) {
    if (error?.code !== 'P2002') throw error
    const concurrentReplay = await replayInventoryMutation(prisma, request)
    if (!concurrentReplay) throw error
    return concurrentReplay
  }
}

export async function replayInventoryMutation(prisma, request) {
  const existing = await prisma.inventoryMaterialMutation.findUnique({
    where: { clientRequestId: request.clientRequestId }
  })
  return existing ? { reused: true, result: validate(existing, request) } : null
}
