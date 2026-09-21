import { describe, expect, it } from 'vitest'
import {
  parseCartDto,
  parseCheckoutProblems,
  parseOrderDto,
  parsePaymentStatusDto,
  parsePreOrderDto
} from '@/features/transaction/contract'
import {
  formatMoneyFromCents,
  moneyToCents,
  toCartViewModel,
  toOrderViewModel
} from '@/features/transaction/view-model'

const now = '2026-09-21T08:00:00.000Z'

function cartFixture() {
  return {
    cartId: 'cart-1',
    items: [
      {
        id: 'item-1',
        itemType: 'CUSTOM',
        contentId: 'custom-1',
        hardwareSkuId: 'sku-1',
        hardwareSkuCode: 'SKU-1',
        snapshotTitle: '私人定制',
        snapshotPreviewUrl: null,
        coverUrl: null,
        configSnapshotJson:
          '{"modelName":"M1","size":"大号","skuFrameCount":12,"material":"木质","colorName":"原木色","ignored":"不可展示"}',
        snapshotPrice: '19.90',
        currentPrice: 20.1,
        quantity: 3,
        selected: true,
        creatorId: null,
        status: 'price_changed',
        customProductId: 'custom-1',
        sessionGroupId: 'group-1'
      },
      {
        id: 'item-2',
        itemType: 'MARKET',
        contentId: 'work-1',
        hardwareSkuId: 'sku-2',
        hardwareSkuCode: null,
        snapshotTitle: '联名作品',
        snapshotPreviewUrl: null,
        coverUrl: 'https://example.test/cover.png',
        configSnapshotJson: null,
        snapshotPrice: 9.99,
        currentPrice: 9.99,
        quantity: 1,
        selected: true,
        creatorId: 'creator-1',
        status: 'stock_out',
        customProductId: null,
        sessionGroupId: null
      }
    ],
    creatorProfiles: {
      'creator-1': { userId: 'creator-1', nickname: '创作者', avatarUrl: null }
    },
    totalSelected: 3,
    totalPrice: '60.30'
  }
}

function orderFixture() {
  return {
    id: 'order-1',
    orderNo: 'SO-1',
    status: 'shipped',
    displayStatus: '运输中',
    statusGroup: 'shipped',
    statusStep: 2,
    sourceType: 'custom',
    platform: 'SELF',
    productTitle: '私人定制',
    coverUrl: null,
    modelName: 'M1',
    size: '大号',
    material: '木质',
    frameCount: 12,
    colorName: '原木色',
    totalAmount: 39.8,
    itemCount: 1,
    totalQuantity: 2,
    items: [
      {
        id: 'order-item-1',
        itemNo: 'SO-1-01',
        itemType: 'CUSTOM',
        productTitle: '私人定制',
        coverUrl: null,
        modelName: 'M1',
        size: '大号',
        material: '木质',
        frameCount: 12,
        colorName: '原木色',
        quantity: 2,
        unitPrice: 19.9,
        lineTotal: 39.8,
        animationAssetId: 'asset-1',
        animationVersionId: 'version-1',
        skuId: 'sku-1',
        productionTasks: [
          {
            id: 'task-1',
            productionNo: 'PU-1',
            unitIndex: 1,
            status: 'shipped',
            trackingNo: 'SF1',
            trackingCompany: '顺丰'
          }
        ]
      }
    ],
    actions: {
      canCancel: false,
      canConfirmReceipt: true,
      canRequestRefund: true,
      canRequestQuality: false
    },
    trackingNo: 'SF1',
    trackingCompany: '顺丰',
    shippedAt: now,
    receivedAt: null,
    receiverName: '张三',
    receiverPhone: '13800138000',
    receiverAddress: '科技园南路88号',
    receiverCity: '广东省 深圳市 南山区',
    createdAt: now,
    updatedAt: now
  }
}

describe('transaction DTO boundary', () => {
  it('whitelists cart fields and rejects an unknown item status', () => {
    const raw = cartFixture()
    const parsed = parseCartDto({ ...raw, injected: '<script>' })
    expect(parsed).not.toHaveProperty('injected')
    expect(parsed.items[0]?.currentPrice).toBe(20.1)

    raw.items[0]!.status = 'hacked'
    expect(() => parseCartDto(raw)).toThrow('购物车商品状态')
  })

  it('does not silently accept malformed or over-precision money', () => {
    expect(() => parseCartDto({ ...cartFixture(), totalPrice: '1.001' })).toThrow('购物车合计')
    expect(() => parseCartDto({ ...cartFixture(), totalPrice: 'NaN' })).toThrow('购物车合计')
  })

  it('accepts the compact expired payment response', () => {
    expect(parsePaymentStatusDto({ status: 'expired', expired: true })).toEqual({
      id: null,
      status: 'expired',
      totalAmount: null,
      expiresAt: null,
      expired: true
    })
  })

  it('validates preorder timestamps and status', () => {
    expect(
      parsePreOrderDto({
        id: 'pre-1',
        status: 'pending_payment',
        totalAmount: '20.00',
        expiresAt: now,
        createdAt: now
      }).totalAmount
    ).toBe(20)
    expect(() =>
      parsePreOrderDto({
        id: 'pre-1',
        status: 'unknown',
        totalAmount: '20.00',
        expiresAt: now,
        createdAt: now
      })
    ).toThrow('预订单状态')
  })

  it('whitelists structured checkout problems', () => {
    expect(
      parseCheckoutProblems({
        problems: [{ id: 'item-1', reason: '价格已变动', internalSnapshot: 'secret' }]
      })
    ).toEqual([{ id: 'item-1', reason: '价格已变动' }])
  })

  it('requires server-supplied order capabilities instead of deriving permissions in a page', () => {
    const parsed = parseOrderDto(orderFixture())
    expect(parsed.actions).toEqual({
      canCancel: false,
      canConfirmReceipt: true,
      canRequestRefund: true,
      canRequestQuality: false
    })
    expect(() => parseOrderDto({ ...orderFixture(), actions: undefined })).toThrow('订单操作能力')
  })
})

describe('transaction view models', () => {
  it('uses integer cents for calculations', () => {
    expect(moneyToCents(0.1 + 0.2)).toBe(30)
    expect(formatMoneyFromCents(30)).toBe('¥0.30')
  })

  it('blocks checkout until price changes are confirmed and ignores unavailable items', () => {
    const view = toCartViewModel(parseCartDto(cartFixture()))
    expect(view.totalPriceCents).toBe(6030)
    expect(view.totalPriceText).toBe('¥60.30')
    expect(view.items[0]?.specificationText).toBe('M1 · 大号 · 12帧 · 木质 · 原木色')
    expect(view.selectedItemIds).toEqual(['item-1'])
    expect(view.hasBlockingItems).toBe(true)
    expect(view.hasPriceChanges).toBe(true)
    expect(view.canCheckout).toBe(false)
  })

  it('formats order specifications, money and private address fields in one place', () => {
    const view = toOrderViewModel(parseOrderDto(orderFixture()))
    expect(view.items[0]?.specificationText).toBe('M1 · 大号 · 12帧 · 木质 · 原木色')
    expect(view.totalAmountText).toBe('¥39.80')
    expect(view.receiverPhoneMasked).toBe('138****8000')
    expect(view.receiverAddressText).toBe('广东省 深圳市 南山区 科技园南路88号')
  })
})
