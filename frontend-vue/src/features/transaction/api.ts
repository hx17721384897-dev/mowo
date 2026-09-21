import { ApiError, apiRequest } from '@/services/api-client'
import {
  parseAftersaleRequestDto,
  parseCartDto,
  parseCheckoutProblems,
  parseMockPaymentResultDto,
  parseOrderDto,
  parseOrderPageDto,
  parsePaymentStatusDto,
  parsePreOrderDto
} from './contract'
import type {
  AftersaleRequestDto,
  AftersaleType,
  CartDto,
  CheckoutAddressDto,
  CheckoutProblemDto,
  MockPaymentResultDto,
  OrderDto,
  OrderPageDto,
  PaymentStatusDto,
  PreOrderDto
} from './types'

export async function getCart(): Promise<CartDto> {
  return parseCartDto(await apiRequest<unknown>('/api/cart'))
}

export async function updateCartItem(
  itemId: string,
  update: { quantity?: number; selected?: boolean }
): Promise<void> {
  await apiRequest(`/api/cart/item/${encodeURIComponent(itemId)}/update`, {
    method: 'POST',
    body: update
  })
}

export async function removeCartItem(itemId: string): Promise<void> {
  await apiRequest(`/api/cart/item/${encodeURIComponent(itemId)}`, { method: 'DELETE' })
}

export async function clearCart(): Promise<void> {
  await apiRequest('/api/cart/clear', { method: 'POST' })
}

export async function confirmAllCartPriceChanges(): Promise<void> {
  await apiRequest('/api/cart/price-changes/confirm-all', { method: 'POST' })
}

export async function checkoutCart(
  cartItemIds: string[],
  address: CheckoutAddressDto,
  idempotencyKey: string
): Promise<PreOrderDto> {
  return parsePreOrderDto(
    await apiRequest<unknown>('/api/cart/checkout', {
      method: 'POST',
      body: { cartItemIds, ...address, idempotencyKey }
    })
  )
}

export function checkoutProblemsFromError(error: unknown): CheckoutProblemDto[] {
  if (!(error instanceof ApiError) || error.code !== 'CHECKOUT_VALIDATION_FAILED') return []
  try {
    return parseCheckoutProblems(error.details)
  } catch {
    return []
  }
}

export async function getPaymentStatus(preOrderId: string): Promise<PaymentStatusDto> {
  return parsePaymentStatusDto(
    await apiRequest<unknown>(`/api/payment/status/${encodeURIComponent(preOrderId)}`)
  )
}

export async function mockPay(preOrderId: string): Promise<MockPaymentResultDto> {
  return parseMockPaymentResultDto(
    await apiRequest<unknown>(`/api/payment/mock-pay/${encodeURIComponent(preOrderId)}`, {
      method: 'POST'
    })
  )
}

export async function getMyOrders(
  tab: 'active' | 'all',
  page = 1,
  limit = 30
): Promise<OrderPageDto> {
  const query = new URLSearchParams({ tab, page: String(page), limit: String(limit) })
  return parseOrderPageDto(await apiRequest<unknown>(`/api/orders/mine?${query.toString()}`))
}

export async function getOrder(orderId: string): Promise<OrderDto> {
  return parseOrderDto(await apiRequest<unknown>(`/api/orders/${encodeURIComponent(orderId)}`))
}

export async function cancelOrder(orderId: string): Promise<void> {
  await apiRequest(`/api/orders/${encodeURIComponent(orderId)}/cancel`, { method: 'POST' })
}

export async function confirmOrderReceipt(orderId: string): Promise<void> {
  await apiRequest(`/api/orders/${encodeURIComponent(orderId)}/confirm-receipt`, {
    method: 'POST'
  })
}

export async function createAftersaleRequest(
  orderId: string,
  request: {
    type: AftersaleType
    reason: string
    description?: string
    imageUrls?: string[]
  }
): Promise<void> {
  await apiRequest(`/api/orders/${encodeURIComponent(orderId)}/aftersale`, {
    method: 'POST',
    body: request
  })
}

export async function getAftersaleRequest(orderId: string): Promise<AftersaleRequestDto | null> {
  return parseAftersaleRequestDto(
    await apiRequest<unknown>(`/api/orders/${encodeURIComponent(orderId)}/aftersale`)
  )
}
