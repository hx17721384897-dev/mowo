export type CartItemType = 'CUSTOM' | 'MARKET'
export type CartItemStatus = 'normal' | 'invalid' | 'stock_out' | 'price_changed'
export type PreOrderStatus = 'pending_payment' | 'paid' | 'expired' | 'cancelled'
export type OrderStatus =
  | 'pending'
  | 'paid'
  | 'locked'
  | 'processing'
  | 'producing'
  | 'shipped'
  | 'received'
  | 'aftersale'
  | 'cancelled'

export interface CreatorProfileDto {
  userId: string
  nickname: string | null
  avatarUrl: string | null
}

export interface CartItemDto {
  id: string
  itemType: CartItemType
  contentId: string
  hardwareSkuId: string
  hardwareSkuCode: string | null
  snapshotTitle: string
  snapshotPreviewUrl: string | null
  coverUrl: string | null
  configSnapshotJson: string | null
  snapshotPrice: number | null
  currentPrice: number | null
  quantity: number
  selected: boolean
  creatorId: string | null
  status: CartItemStatus
  customProductId: string | null
  sessionGroupId: string | null
}

export interface CartDto {
  cartId: string
  items: CartItemDto[]
  creatorProfiles: Record<string, CreatorProfileDto>
  totalSelected: number
  totalPrice: number
}

export interface CheckoutAddressDto {
  receiverName: string
  receiverPhone: string
  receiverAddress: string
  receiverCity: string
}

export interface CheckoutProblemDto {
  id: string
  reason: string
}

export interface PreOrderDto {
  id: string
  status: PreOrderStatus
  totalAmount: number
  expiresAt: string
  createdAt: string
}

export interface PaymentStatusDto {
  id: string | null
  status: PreOrderStatus
  totalAmount: number | null
  expiresAt: string | null
  expired: boolean
}

export interface MockPaymentResultDto {
  orderId: string
  orderNo: string
}

export type AftersaleType = 'refund' | 'quality'
export type AftersaleStatus = 'pending' | 'approved' | 'rejected' | 'completed' | 'cancelled'

export interface AftersaleRequestDto {
  id: string
  type: AftersaleType
  reason: string
  description: string | null
  status: AftersaleStatus
  adminNote: string | null
  processedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface OrderActionsDto {
  canCancel: boolean
  canConfirmReceipt: boolean
  canRequestRefund: boolean
  canRequestQuality: boolean
}

export interface ProductionTaskDto {
  id: string
  productionNo: string
  unitIndex: number
  status: OrderStatus
  trackingNo: string | null
  trackingCompany: string | null
}

export interface OrderItemDto {
  id: string
  itemNo: string
  itemType: CartItemType
  productTitle: string
  coverUrl: string | null
  modelName: string | null
  size: string | null
  material: string | null
  frameCount: number | null
  colorName: string | null
  quantity: number
  unitPrice: number
  lineTotal: number
  animationAssetId: string | null
  animationVersionId: string | null
  skuId: string
  productionTasks: ProductionTaskDto[]
}

export interface OrderDto {
  id: string
  orderNo: string
  status: OrderStatus
  displayStatus: string
  statusGroup: string
  statusStep: number
  sourceType: 'custom' | 'collab'
  platform: string
  productTitle: string
  coverUrl: string | null
  modelName: string | null
  size: string | null
  material: string | null
  frameCount: number | null
  colorName: string | null
  totalAmount: number
  itemCount: number
  totalQuantity: number
  items: OrderItemDto[]
  actions: OrderActionsDto
  trackingNo: string | null
  trackingCompany: string | null
  shippedAt: string | null
  receivedAt: string | null
  receiverName: string | null
  receiverPhone: string | null
  receiverAddress: string | null
  receiverCity: string | null
  createdAt: string
  updatedAt: string
  legacy: boolean
}

export interface OrderPageDto {
  orders: OrderDto[]
  activeCount: number
  totalCount: number
  page: number
  limit: number
  hasMore: boolean
}

export interface CartItemViewModel extends CartItemDto {
  creator: CreatorProfileDto | null
  unitPriceCents: number
  unitPriceText: string
  snapshotPriceText: string | null
  lineTotalCents: number
  lineTotalText: string
  specificationText: string | null
  selectable: boolean
  statusText: string | null
  priceChanged: boolean
}

export interface CartViewModel {
  cartId: string
  items: CartItemViewModel[]
  selectedItemIds: string[]
  totalSelected: number
  totalPriceCents: number
  totalPriceText: string
  hasBlockingItems: boolean
  hasPriceChanges: boolean
  canCheckout: boolean
}

export interface OrderItemViewModel extends OrderItemDto {
  specificationText: string
  unitPriceText: string
  lineTotalText: string
}

export interface OrderViewModel extends Omit<OrderDto, 'items'> {
  items: OrderItemViewModel[]
  totalAmountCents: number
  totalAmountText: string
  createdAtText: string
  receiverPhoneMasked: string | null
  receiverAddressText: string | null
}
