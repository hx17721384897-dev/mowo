import { maskAddressPhone } from '@/features/address/address-utils'
import type { CartDto, CartItemStatus, CartViewModel, OrderDto, OrderViewModel } from './types'

const CART_STATUS_TEXT: Record<CartItemStatus, string | null> = {
  normal: null,
  invalid: '商品已失效',
  stock_out: '库存不足',
  price_changed: '价格已变动'
}

export function moneyToCents(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error('金额格式不正确')
  return Math.round((value + Number.EPSILON) * 100)
}

export function formatMoneyFromCents(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('金额格式不正确')
  return `¥${(cents / 100).toFixed(2)}`
}

function cartSpecification(value: string | null): string | null {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const config = parsed as Record<string, unknown>
    const frameCount =
      typeof config.skuFrameCount === 'number' && Number.isSafeInteger(config.skuFrameCount)
        ? `${config.skuFrameCount}帧`
        : null
    const values = [config.modelName, config.size, frameCount, config.material, config.colorName]
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => String(value).slice(0, 100))
    return values.join(' · ') || null
  } catch {
    return null
  }
}

export function toCartViewModel(cart: CartDto): CartViewModel {
  const items = cart.items.map((item) => {
    const unitPrice = item.currentPrice ?? item.snapshotPrice ?? 0
    const unitPriceCents = moneyToCents(unitPrice)
    const selectable = item.status !== 'invalid' && item.status !== 'stock_out'
    return {
      ...item,
      creator: item.creatorId ? (cart.creatorProfiles[item.creatorId] ?? null) : null,
      unitPriceCents,
      unitPriceText: formatMoneyFromCents(unitPriceCents),
      snapshotPriceText:
        item.snapshotPrice == null ? null : formatMoneyFromCents(moneyToCents(item.snapshotPrice)),
      lineTotalCents: unitPriceCents * item.quantity,
      lineTotalText: formatMoneyFromCents(unitPriceCents * item.quantity),
      specificationText: cartSpecification(item.configSnapshotJson),
      selectable,
      statusText: CART_STATUS_TEXT[item.status],
      priceChanged: item.status === 'price_changed'
    }
  })
  const selected = items.filter((item) => item.selected && item.selectable)
  const totalPriceCents = moneyToCents(cart.totalPrice)
  return {
    cartId: cart.cartId,
    items,
    selectedItemIds: selected.map((item) => item.id),
    totalSelected: cart.totalSelected,
    totalPriceCents,
    totalPriceText: formatMoneyFromCents(totalPriceCents),
    hasBlockingItems: items.some((item) => !item.selectable),
    hasPriceChanges: items.some((item) => item.priceChanged),
    canCheckout: selected.length > 0 && selected.every((item) => !item.priceChanged)
  }
}

export function toOrderViewModel(order: OrderDto): OrderViewModel {
  const totalAmountCents = moneyToCents(order.totalAmount)
  return {
    ...order,
    items: order.items.map((item) => {
      const specificationText = [
        item.modelName,
        item.size,
        item.frameCount ? `${item.frameCount}帧` : null,
        item.material,
        item.colorName
      ]
        .filter(Boolean)
        .join(' · ')
      return {
        ...item,
        specificationText: specificationText || '—',
        unitPriceText: formatMoneyFromCents(moneyToCents(item.unitPrice)),
        lineTotalText: formatMoneyFromCents(moneyToCents(item.lineTotal))
      }
    }),
    totalAmountCents,
    totalAmountText: formatMoneyFromCents(totalAmountCents),
    createdAtText: new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(order.createdAt)),
    receiverPhoneMasked: order.receiverPhone ? maskAddressPhone(order.receiverPhone) : null,
    receiverAddressText:
      [order.receiverCity, order.receiverAddress].filter(Boolean).join(' ') || null
  }
}
