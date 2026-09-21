import type {
  AftersaleRequestDto,
  AftersaleStatus,
  AftersaleType,
  CartDto,
  CartItemDto,
  CartItemStatus,
  CartItemType,
  CheckoutProblemDto,
  CheckoutCapabilitiesDto,
  CreatorProfileDto,
  MockPaymentResultDto,
  OrderActionsDto,
  OrderDto,
  OrderItemDto,
  OrderPageDto,
  OrderStatus,
  PaymentStatusDto,
  PreOrderDto,
  PreOrderStatus,
  ProductionTaskDto
} from './types'

const CART_ITEM_TYPES = new Set<CartItemType>(['CUSTOM', 'MARKET'])
const CART_ITEM_STATUSES = new Set<CartItemStatus>([
  'normal',
  'invalid',
  'stock_out',
  'price_changed'
])
const PRE_ORDER_STATUSES = new Set<PreOrderStatus>([
  'pending_payment',
  'paid',
  'expired',
  'cancelled'
])
const ORDER_STATUSES = new Set<OrderStatus>([
  'pending',
  'paid',
  'locked',
  'processing',
  'producing',
  'shipped',
  'received',
  'aftersale',
  'cancelled'
])
const AFTERSALE_TYPES = new Set<AftersaleType>(['refund', 'quality'])
const AFTERSALE_STATUSES = new Set<AftersaleStatus>([
  'pending',
  'approved',
  'rejected',
  'completed',
  'cancelled'
])

function invalid(label: string): never {
  throw new Error(`交易接口响应格式不正确：${label}`)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(label)
  return value as Record<string, unknown>
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) return invalid(label)
  return value
}

function nullableString(value: unknown, label: string): string | null {
  if (value == null) return null
  if (typeof value !== 'string') return invalid(label)
  return value || null
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') return invalid(label)
  return value
}

function integer(value: unknown, label: string, minimum = 0): number {
  const parsed = typeof value === 'number' ? value : Number.NaN
  if (!Number.isSafeInteger(parsed) || parsed < minimum) return invalid(label)
  return parsed
}

export function parseMoney(value: unknown, label = '金额'): number {
  if (typeof value !== 'number' && typeof value !== 'string') return invalid(label)
  const text = String(value).trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return invalid(label)
  const parsed = Number(text)
  if (!Number.isFinite(parsed) || parsed < 0) return invalid(label)
  return parsed
}

function nullableMoney(value: unknown, label: string): number | null {
  return value == null ? null : parseMoney(value, label)
}

function timestamp(value: unknown, label: string): string {
  const text = requiredString(value, label)
  if (!Number.isFinite(Date.parse(text))) return invalid(label)
  return text
}

function nullableTimestamp(value: unknown, label: string): string | null {
  return value == null ? null : timestamp(value, label)
}

function enumValue<T extends string>(value: unknown, values: Set<T>, label: string): T {
  if (!values.has(value as T)) return invalid(label)
  return value as T
}

function creator(value: unknown): CreatorProfileDto {
  const row = record(value, '创作者资料')
  return {
    userId: requiredString(row.userId, '创作者 ID'),
    nickname: nullableString(row.nickname, '创作者昵称'),
    avatarUrl: nullableString(row.avatarUrl, '创作者头像')
  }
}

function cartItem(value: unknown): CartItemDto {
  const row = record(value, '购物车商品')
  return {
    id: requiredString(row.id, '购物车商品 ID'),
    itemType: enumValue(row.itemType, CART_ITEM_TYPES, '购物车商品类型'),
    contentId: requiredString(row.contentId, '购物车内容 ID'),
    hardwareSkuId: requiredString(row.hardwareSkuId, '购物车 SKU ID'),
    hardwareSkuCode: nullableString(row.hardwareSkuCode, '购物车 SKU 编码'),
    snapshotTitle: requiredString(row.snapshotTitle, '购物车商品标题'),
    snapshotPreviewUrl: nullableString(row.snapshotPreviewUrl, '购物车预览图'),
    coverUrl: nullableString(row.coverUrl, '购物车封面图'),
    configSnapshotJson: nullableString(row.configSnapshotJson, '购物车配置快照'),
    snapshotPrice: nullableMoney(row.snapshotPrice, '购物车快照价格'),
    currentPrice: nullableMoney(row.currentPrice, '购物车当前价格'),
    quantity: integer(row.quantity, '购物车数量', 1),
    selected: boolean(row.selected, '购物车选中状态'),
    creatorId: nullableString(row.creatorId, '购物车创作者 ID'),
    status: enumValue(row.status, CART_ITEM_STATUSES, '购物车商品状态'),
    customProductId: nullableString(row.customProductId, '私人定制 ID'),
    sessionGroupId: nullableString(row.sessionGroupId, '购物车分组 ID')
  }
}

export function parseCartDto(value: unknown): CartDto {
  const row = record(value, '购物车')
  if (!Array.isArray(row.items)) return invalid('购物车商品列表')
  const profiles = record(row.creatorProfiles ?? {}, '创作者资料索引')
  return {
    cartId: requiredString(row.cartId, '购物车 ID'),
    items: row.items.map(cartItem),
    creatorProfiles: Object.fromEntries(
      Object.entries(profiles).map(([key, profile]) => [key, creator(profile)])
    ),
    totalSelected: integer(row.totalSelected, '购物车选中数量'),
    totalPrice: parseMoney(row.totalPrice, '购物车合计')
  }
}

export function parsePreOrderDto(value: unknown): PreOrderDto {
  const row = record(value, '预订单')
  return {
    id: requiredString(row.id, '预订单 ID'),
    status: enumValue(row.status, PRE_ORDER_STATUSES, '预订单状态'),
    totalAmount: parseMoney(row.totalAmount, '预订单金额'),
    expiresAt: timestamp(row.expiresAt, '预订单过期时间'),
    createdAt: timestamp(row.createdAt, '预订单创建时间')
  }
}

export function parseCheckoutProblems(value: unknown): CheckoutProblemDto[] {
  const row = record(value, '结算失败详情')
  if (!Array.isArray(row.problems)) return invalid('结算失败商品列表')
  return row.problems.map((value) => {
    const problem = record(value, '结算失败商品')
    return {
      id: requiredString(problem.id, '结算失败商品 ID'),
      reason: requiredString(problem.reason, '结算失败原因')
    }
  })
}

export function parseCheckoutCapabilitiesDto(value: unknown): CheckoutCapabilitiesDto {
  const row = record(value, '交易功能配置')
  return {
    onlineCheckout: boolean(row.onlineCheckout, '在线结算开关'),
    mockPayment: boolean(row.mockPayment, '模拟支付开关')
  }
}

export function parsePaymentStatusDto(value: unknown): PaymentStatusDto {
  const row = record(value, '支付状态')
  return {
    id: nullableString(row.id, '预订单 ID'),
    status: enumValue(row.status, PRE_ORDER_STATUSES, '支付状态'),
    totalAmount: nullableMoney(row.totalAmount, '支付金额'),
    expiresAt: nullableTimestamp(row.expiresAt, '支付过期时间'),
    expired: boolean(row.expired, '支付过期标记')
  }
}

export function parseMockPaymentResultDto(value: unknown): MockPaymentResultDto {
  const row = record(value, '模拟支付结果')
  return {
    orderId: requiredString(row.id, '正式订单 ID'),
    orderNo: requiredString(row.orderNo, '正式订单编号')
  }
}

export function parseAftersaleRequestDto(value: unknown): AftersaleRequestDto | null {
  if (value == null) return null
  const row = record(value, '售后申请')
  return {
    id: requiredString(row.id, '售后申请 ID'),
    type: enumValue(row.type, AFTERSALE_TYPES, '售后申请类型'),
    reason: requiredString(row.reason, '售后申请原因'),
    description: nullableString(row.description, '售后说明'),
    status: enumValue(row.status, AFTERSALE_STATUSES, '售后状态'),
    adminNote: nullableString(row.adminNote, '售后处理说明'),
    processedAt: nullableTimestamp(row.processedAt, '售后处理时间'),
    createdAt: timestamp(row.createdAt, '售后创建时间'),
    updatedAt: timestamp(row.updatedAt, '售后更新时间')
  }
}

function actions(value: unknown): OrderActionsDto {
  const row = record(value, '订单操作能力')
  return {
    canCancel: boolean(row.canCancel, '可取消标记'),
    canConfirmReceipt: boolean(row.canConfirmReceipt, '可确认收货标记'),
    canRequestRefund: boolean(row.canRequestRefund, '可退款标记'),
    canRequestQuality: boolean(row.canRequestQuality, '可质量售后标记')
  }
}

function productionTask(value: unknown): ProductionTaskDto {
  const row = record(value, '生产任务')
  return {
    id: requiredString(row.id, '生产任务 ID'),
    productionNo: requiredString(row.productionNo, '生产任务编号'),
    unitIndex: integer(row.unitIndex, '生产任务序号', 1),
    status: enumValue(row.status, ORDER_STATUSES, '生产任务状态'),
    trackingNo: nullableString(row.trackingNo, '物流单号'),
    trackingCompany: nullableString(row.trackingCompany, '物流公司')
  }
}

function orderItem(value: unknown): OrderItemDto {
  const row = record(value, '订单商品')
  if (!Array.isArray(row.productionTasks)) return invalid('订单生产任务列表')
  return {
    id: requiredString(row.id, '订单商品 ID'),
    itemNo: requiredString(row.itemNo, '订单商品编号'),
    itemType: enumValue(row.itemType, CART_ITEM_TYPES, '订单商品类型'),
    productTitle: requiredString(row.productTitle, '订单商品标题'),
    coverUrl: nullableString(row.coverUrl, '订单商品封面'),
    modelName: nullableString(row.modelName, '订单机型'),
    size: nullableString(row.size, '订单尺寸'),
    material: nullableString(row.material, '订单材质'),
    frameCount: row.frameCount == null ? null : integer(row.frameCount, '订单帧数', 1),
    colorName: nullableString(row.colorName, '订单颜色'),
    quantity: integer(row.quantity, '订单商品数量', 1),
    unitPrice: parseMoney(row.unitPrice, '订单商品单价'),
    lineTotal: parseMoney(row.lineTotal, '订单商品小计'),
    animationAssetId: nullableString(row.animationAssetId, '动画资产 ID'),
    animationVersionId: nullableString(row.animationVersionId, '动画版本 ID'),
    skuId: requiredString(row.skuId, '订单 SKU ID'),
    productionTasks: row.productionTasks.map(productionTask)
  }
}

export function parseOrderDto(value: unknown): OrderDto {
  const row = record(value, '订单')
  if (!Array.isArray(row.items)) return invalid('订单商品列表')
  const sourceType = row.sourceType
  if (sourceType !== 'custom' && sourceType !== 'collab') return invalid('订单来源类型')
  return {
    id: requiredString(row.id, '订单 ID'),
    orderNo: requiredString(row.orderNo, '订单编号'),
    status: enumValue(row.status, ORDER_STATUSES, '订单状态'),
    displayStatus: requiredString(row.displayStatus, '订单展示状态'),
    statusGroup: requiredString(row.statusGroup, '订单状态分组'),
    statusStep: integer(row.statusStep, '订单状态步骤', -1),
    sourceType,
    platform: requiredString(row.platform, '订单平台'),
    productTitle: requiredString(row.productTitle, '订单标题'),
    coverUrl: nullableString(row.coverUrl, '订单封面'),
    modelName: nullableString(row.modelName, '订单机型'),
    size: nullableString(row.size, '订单尺寸'),
    material: nullableString(row.material, '订单材质'),
    frameCount: row.frameCount == null ? null : integer(row.frameCount, '订单帧数', 1),
    colorName: nullableString(row.colorName, '订单颜色'),
    totalAmount: parseMoney(row.totalAmount, '订单金额'),
    itemCount: integer(row.itemCount, '订单商品种类'),
    totalQuantity: integer(row.totalQuantity, '订单商品数量'),
    items: row.items.map(orderItem),
    actions: actions(row.actions),
    trackingNo: nullableString(row.trackingNo, '订单物流单号'),
    trackingCompany: nullableString(row.trackingCompany, '订单物流公司'),
    shippedAt: nullableTimestamp(row.shippedAt, '订单发货时间'),
    receivedAt: nullableTimestamp(row.receivedAt, '订单收货时间'),
    receiverName: nullableString(row.receiverName, '订单收件人'),
    receiverPhone: nullableString(row.receiverPhone, '订单收件电话'),
    receiverAddress: nullableString(row.receiverAddress, '订单收件地址'),
    receiverCity: nullableString(row.receiverCity, '订单收件城市'),
    createdAt: timestamp(row.createdAt, '订单创建时间'),
    updatedAt: timestamp(row.updatedAt, '订单更新时间'),
    legacy: row.legacy === true
  }
}

export function parseOrderPageDto(value: unknown): OrderPageDto {
  const row = record(value, '订单列表')
  if (!Array.isArray(row.orders)) return invalid('订单列表数据')
  return {
    orders: row.orders.map(parseOrderDto),
    activeCount: integer(row.activeCount, '进行中订单数'),
    totalCount: integer(row.totalCount, '全部订单数'),
    page: integer(row.page, '订单页码', 1),
    limit: integer(row.limit, '订单每页数量', 1),
    hasMore: boolean(row.hasMore, '订单下一页标记')
  }
}
