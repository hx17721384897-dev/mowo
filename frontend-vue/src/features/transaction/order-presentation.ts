import type { AftersaleStatus, OrderStatus, OrderViewModel } from './types'

export const ORDER_STEPS = ['待付款', '已付款', '制作中', '运输中', '已完成'] as const

export const ORDER_STATUS_ICON: Record<OrderStatus, string> = {
  pending: '⏳',
  paid: '✓',
  locked: '🎨',
  processing: '🎨',
  producing: '🎨',
  shipped: '🚚',
  received: '✅',
  aftersale: '🔄',
  cancelled: '❌'
}

export const AFTERSALE_STATUS_LABEL: Record<AftersaleStatus, string> = {
  pending: '待处理',
  approved: '已同意',
  rejected: '已拒绝',
  completed: '已完成',
  cancelled: '已取消'
}

export const AFTERSALE_REASONS = {
  refund: ['不想要了', '拍错了', '价格有变动', '物流异常/未收到货', '其他原因'],
  quality: ['机器运转异常', '帧图印刷错误/模糊', '外壳破损或配件缺失', '与描述不符', '其他质量问题']
} as const

export function orderProgressVisible(order: OrderViewModel): boolean {
  return order.statusStep >= 0 && order.statusStep < ORDER_STEPS.length
}

export function orderProgressWidth(order: OrderViewModel): string {
  return `${(Math.min(ORDER_STEPS.length - 1, Math.max(0, order.statusStep)) * 100) / (ORDER_STEPS.length - 1)}%`
}

export function orderStatusClass(order: OrderViewModel): string {
  if (order.status === 'pending') return 'status-pending'
  if (order.status === 'shipped') return 'status-shipped'
  if (order.status === 'cancelled') return 'status-cancelled'
  if (order.status === 'received' || order.status === 'aftersale') return 'status-done'
  return 'status-making'
}

export function orderEta(order: OrderViewModel): string | null {
  if (order.status === 'paid' && order.earliestProductionAt) {
    const time = new Date(order.earliestProductionAt)
    if (!Number.isNaN(time.getTime()))
      return `最早可开始制作：${time.toLocaleString('zh-CN', { hour12: false })}`
  }
  if (order.status === 'shipped') return order.trackingNo ? null : '已发货，请留意快递通知'
  return null
}
