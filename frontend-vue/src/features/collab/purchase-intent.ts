export const COLLAB_INTENT_KEY = 'mowo_collab_pending_action_v1'
const MAX_AGE_MS = 15 * 60 * 1000

export interface CollabIntent {
  workId: string
  skuId: string
  quantity: number
  action: 'prepare-purchase'
  createdAt: number
}

export function saveCollabIntent(intent: CollabIntent): void {
  localStorage.setItem(COLLAB_INTENT_KEY, JSON.stringify(intent))
}

export function readCollabIntent(now = Date.now()): CollabIntent | null {
  try {
    const value = JSON.parse(
      localStorage.getItem(COLLAB_INTENT_KEY) ?? 'null'
    ) as Partial<CollabIntent> | null
    const valid =
      value &&
      typeof value.workId === 'string' &&
      typeof value.skuId === 'string' &&
      Number.isInteger(value.quantity) &&
      Number(value.quantity) >= 1 &&
      Number(value.quantity) <= 10 &&
      value.action === 'prepare-purchase' &&
      typeof value.createdAt === 'number' &&
      now - value.createdAt >= 0 &&
      now - value.createdAt <= MAX_AGE_MS
    if (valid) return value as CollabIntent
  } catch {
    // Corrupt client storage is discarded below.
  }
  clearCollabIntent()
  return null
}

export function clearCollabIntent(): void {
  localStorage.removeItem(COLLAB_INTENT_KEY)
}
