import type { PreOrderDto } from './types'
import { parsePreOrderDto } from './contract'

const SELECTION_KEY = 'mowo_checkout_items'
const ATTEMPT_KEY = 'mowo_checkout_attempt_v1'

export interface CheckoutAttempt {
  signature: string
  idempotencyKey: string
  preOrder: PreOrderDto | null
}

export function readCheckoutItemIds(storage: Storage = sessionStorage): string[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(SELECTION_KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    return [
      ...new Set(parsed.filter((id): id is string => typeof id === 'string' && id.trim() !== ''))
    ]
  } catch {
    return []
  }
}

export function checkoutSignature(itemIds: string[]): string {
  return [...new Set(itemIds)].sort().join('|')
}

function validAttempt(value: unknown, signature: string): CheckoutAttempt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const attempt = value as Record<string, unknown>
  if (
    attempt.signature !== signature ||
    typeof attempt.idempotencyKey !== 'string' ||
    !attempt.idempotencyKey.startsWith('checkout-')
  ) {
    return null
  }
  let preOrder: PreOrderDto | null = null
  try {
    preOrder = attempt.preOrder == null ? null : parsePreOrderDto(attempt.preOrder)
  } catch {
    return null
  }
  return { signature, idempotencyKey: attempt.idempotencyKey, preOrder }
}

export function getOrCreateCheckoutAttempt(
  itemIds: string[],
  storage: Storage = sessionStorage
): CheckoutAttempt {
  const signature = checkoutSignature(itemIds)
  if (!signature) throw new Error('结算商品为空')
  try {
    const existing = validAttempt(JSON.parse(storage.getItem(ATTEMPT_KEY) || 'null'), signature)
    if (existing) return existing
  } catch {
    // 损坏的会话缓存由下方新凭据覆盖。
  }
  const attempt: CheckoutAttempt = {
    signature,
    idempotencyKey: `checkout-${crypto.randomUUID()}`.slice(0, 100),
    preOrder: null
  }
  storage.setItem(ATTEMPT_KEY, JSON.stringify(attempt))
  return attempt
}

export function saveCheckoutPreOrder(
  attempt: CheckoutAttempt,
  preOrder: PreOrderDto,
  storage: Storage = sessionStorage
): CheckoutAttempt {
  const saved = { ...attempt, preOrder }
  storage.setItem(ATTEMPT_KEY, JSON.stringify(saved))
  return saved
}

export function clearCheckoutSession(storage: Storage = sessionStorage): void {
  storage.removeItem(SELECTION_KEY)
  storage.removeItem(ATTEMPT_KEY)
}
