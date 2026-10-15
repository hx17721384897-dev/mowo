export const FULFILLMENT_HOLD_KEY = 'fulfillment_hold_minutes'
export const DEFAULT_FULFILLMENT_HOLD_MINUTES = 60
export const MAX_FULFILLMENT_HOLD_MINUTES = 10080

export function parseFulfillmentHoldMinutes(value) {
  if (value == null || value === '') return null
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !/^\d+$/.test(value)) return null
  const minutes = Number(value)
  return Number.isInteger(minutes) && minutes >= 0 && minutes <= MAX_FULFILLMENT_HOLD_MINUTES
    ? minutes : null
}

export async function readFulfillmentHoldMinutes(prisma) {
  const config = await prisma.platformConfig.findUnique({ where: { configKey: FULFILLMENT_HOLD_KEY } })
  return parseFulfillmentHoldMinutes(config?.configValue) ?? DEFAULT_FULFILLMENT_HOLD_MINUTES
}

export function earliestProductionAt(paidAt, minutes) {
  return new Date(paidAt.getTime() + minutes * 60_000)
}

export function isFulfillmentHoldActive(order, now = new Date()) {
  return order.earliestProductionAt instanceof Date && order.earliestProductionAt > now
}
