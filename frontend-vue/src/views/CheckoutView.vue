<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AddressBook from '@/features/address/AddressBook.vue'
import type { Address } from '@/features/address/types'
import {
  checkoutCart,
  checkoutProblemsFromError,
  getCart,
  getCheckoutCapabilities,
  getPaymentStatus,
  mockPay
} from '@/features/transaction/api'
import {
  clearCheckoutSession,
  getOrCreateCheckoutAttempt,
  readCheckoutItemIds,
  saveCheckoutPreOrder,
  type CheckoutAttempt
} from '@/features/transaction/checkout-session'
import type {
  CartItemViewModel,
  CheckoutCapabilitiesDto,
  PreOrderDto
} from '@/features/transaction/types'
import { formatMoneyFromCents, toCartViewModel } from '@/features/transaction/view-model'
import '@/features/transaction/checkout.css'

type CheckoutPhase = 'form' | 'pending' | 'success' | 'expired'

const router = useRouter()
const loading = ref(true)
const error = ref('')
const items = ref<CartItemViewModel[]>([])
const capabilities = ref<CheckoutCapabilitiesDto>({ onlineCheckout: false, mockPayment: false })
const selectedAddressId = ref<string | null>(null)
const selectedAddress = ref<Address | null>(null)
const attempt = ref<CheckoutAttempt | null>(null)
const preOrder = ref<PreOrderDto | null>(null)
const phase = ref<CheckoutPhase>('form')
const submitting = ref(false)
const mockPaying = ref(false)
const now = ref(Date.now())
const toast = ref('')
let clockTimer: ReturnType<typeof setInterval> | undefined
let pollTimer: ReturnType<typeof setInterval> | undefined
let toastTimer: ReturnType<typeof setTimeout> | undefined
let statusRefreshing = false

const totalCents = computed(() => items.value.reduce((sum, item) => sum + item.lineTotalCents, 0))
const totalText = computed(() => formatMoneyFromCents(totalCents.value))
const remainingSeconds = computed(() => {
  if (!preOrder.value) return 0
  return Math.max(0, Math.ceil((new Date(preOrder.value.expiresAt).getTime() - now.value) / 1000))
})
const remainingText = computed(() => {
  const minutes = Math.floor(remainingSeconds.value / 60)
  const seconds = remainingSeconds.value % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
})

function showToast(message: string): void {
  toast.value = message
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 2600)
}

function stopTimers(): void {
  if (clockTimer) clearInterval(clockTimer)
  if (pollTimer) clearInterval(pollTimer)
  clockTimer = undefined
  pollTimer = undefined
}

async function refreshPaymentStatus(): Promise<void> {
  if (!preOrder.value || phase.value !== 'pending' || statusRefreshing) return
  statusRefreshing = true
  try {
    const status = await getPaymentStatus(preOrder.value.id)
    if (status.status === 'paid') finishPayment()
    else if (status.status === 'expired' || status.expired) {
      phase.value = 'expired'
      stopTimers()
    }
  } catch {
    // 轮询失败保留当前页面，下个周期继续；不伪造支付结果。
  } finally {
    statusRefreshing = false
  }
}

function startPending(value: PreOrderDto): void {
  preOrder.value = value
  stopTimers()
  if (value.status === 'paid') {
    finishPayment()
    return
  }
  phase.value = value.status === 'expired' ? 'expired' : 'pending'
  if (phase.value !== 'pending') return
  now.value = Date.now()
  clockTimer = setInterval(() => {
    now.value = Date.now()
    if (remainingSeconds.value <= 0) {
      // 页面倒计时不自行宣称库存已释放，等待服务端以事务完成过期和释放。
      void refreshPaymentStatus()
    }
  }, 1000)
  pollTimer = setInterval(() => void refreshPaymentStatus(), 5000)
  void refreshPaymentStatus()
}

function finishPayment(): void {
  phase.value = 'success'
  stopTimers()
  clearCheckoutSession()
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  const itemIds = readCheckoutItemIds()
  if (!itemIds.length) {
    error.value = '没有可结算的商品，请返回购物车重新选择'
    loading.value = false
    return
  }
  try {
    const [cartDto, featureDto] = await Promise.all([getCart(), getCheckoutCapabilities()])
    capabilities.value = featureDto
    const cart = toCartViewModel(cartDto)
    const itemMap = new Map(cart.items.map((item) => [item.id, item]))
    const selected = itemIds.map((id) => itemMap.get(id)).filter(Boolean) as CartItemViewModel[]
    if (selected.length !== itemIds.length) throw new Error('部分商品已不在购物车，请返回重新选择')
    if (selected.some((item) => !item.selectable)) throw new Error('部分商品已失效或库存不足')
    if (selected.some((item) => item.priceChanged))
      throw new Error('部分商品价格已变化，请返回购物车确认')
    items.value = selected
    attempt.value = getOrCreateCheckoutAttempt(itemIds)
    if (attempt.value.preOrder) startPending(attempt.value.preOrder)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '结算信息加载失败'
  } finally {
    loading.value = false
  }
}

function chooseAddress(address: Address | null): void {
  selectedAddress.value = address
}

async function submit(): Promise<void> {
  if (submitting.value || !attempt.value) return
  const address = selectedAddress.value
  if (!address) {
    showToast('请选择或新增收货地址')
    return
  }
  if (!capabilities.value.onlineCheckout) {
    showToast('当前暂未开放在线结算')
    return
  }
  submitting.value = true
  try {
    const value = await checkoutCart(
      items.value.map((item) => item.id),
      {
        receiverName: address.name,
        receiverPhone: address.phone,
        receiverCity: address.city,
        receiverAddress: [address.province, address.city, address.district, address.detail]
          .filter(Boolean)
          .join(' ')
      },
      attempt.value.idempotencyKey
    )
    attempt.value = saveCheckoutPreOrder(attempt.value, value)
    startPending(value)
  } catch (cause) {
    const problems = checkoutProblemsFromError(cause)
    showToast(
      problems.length
        ? problems.map((problem) => problem.reason).join('；')
        : cause instanceof Error
          ? cause.message
          : '提交失败，请稍后重试'
    )
  } finally {
    submitting.value = false
  }
}

async function simulatePayment(): Promise<void> {
  if (!preOrder.value || !capabilities.value.mockPayment || mockPaying.value) return
  mockPaying.value = true
  try {
    await mockPay(preOrder.value.id)
    finishPayment()
  } catch (cause) {
    showToast(cause instanceof Error ? cause.message : '模拟支付失败')
  } finally {
    mockPaying.value = false
  }
}

function restartCheckout(): void {
  clearCheckoutSession()
  void router.push('/cart')
}

onMounted(load)
onBeforeUnmount(() => {
  stopTimers()
  if (toastTimer) clearTimeout(toastTimer)
})
</script>

<template>
  <main class="checkout-main">
    <RouterLink to="/cart" class="back-link">← 返回购物车</RouterLink>
    <h1 class="page-title">确认订单</h1>

    <div v-if="loading" class="checkout-state">加载中...</div>
    <div v-else-if="error" class="checkout-state error" role="alert">
      <p>{{ error }}</p>
      <RouterLink to="/cart" class="btn-secondary">返回购物车</RouterLink>
    </div>

    <template v-else-if="phase === 'form'">
      <section class="card">
        <div class="card-title"><span class="step-dot">1</span> 商品确认</div>
        <div class="product-list">
          <div v-for="item in items" :key="item.id" class="product-row">
            <div class="product-cover">
              <img
                v-if="item.snapshotPreviewUrl || item.coverUrl"
                :src="item.snapshotPreviewUrl || item.coverUrl || ''"
                alt=""
              />
              <div v-else class="cover-placeholder">
                {{ item.itemType === 'CUSTOM' ? '🎨' : '🎁' }}
              </div>
            </div>
            <div>
              <div class="product-name">{{ item.snapshotTitle }}</div>
              <div class="product-meta">
                {{ item.itemType === 'CUSTOM' ? 'DIY 定制款' : '联名成品' }} · ×{{ item.quantity }}
              </div>
            </div>
            <div>
              <div class="product-price">{{ item.unitPriceText }}</div>
              <div class="product-qty">×{{ item.quantity }}</div>
            </div>
          </div>
        </div>
      </section>

      <section class="card address-card-wrap">
        <div class="card-title"><span class="step-dot">2</span> 收货信息</div>
        <AddressBook
          v-model="selectedAddressId"
          mode="select"
          @selected="chooseAddress"
          @notice="(message) => showToast(message)"
        />
      </section>

      <section class="card">
        <div class="card-title"><span class="step-dot">3</span> 费用明细</div>
        <div class="cost-row">
          <span>商品小计</span><span>{{ totalText }}</span>
        </div>
        <div class="cost-row free"><span>运费</span><span>包邮 ¥0</span></div>
        <div class="cost-row total">
          <span>合计</span><span>{{ totalText }}</span>
        </div>
      </section>

      <p v-if="!capabilities.onlineCheckout" class="checkout-closed">
        当前暂未开放在线结算，请稍后从正式支付入口完成购买。
      </p>
      <button
        class="btn-pay"
        type="button"
        :disabled="submitting || !selectedAddress || !capabilities.onlineCheckout"
        @click="submit"
      >
        {{ submitting ? '提交中...' : `提交订单 ${totalText}` }}
      </button>
    </template>

    <section v-else-if="phase === 'pending'" class="card">
      <div class="pay-status-box">
        <div class="pay-status-icon">⏳</div>
        <div class="pay-status-title">订单已生成</div>
        <div class="pay-status-desc">
          订单金额
          {{ preOrder ? formatMoneyFromCents(Math.round(preOrder.totalAmount * 100)) : totalText
          }}<br />
          请在 10 分钟内完成付款
        </div>
        <div class="pay-timer">剩余时间: {{ remainingText }}</div>
        <p class="handoff-note">微信小程序付款入口将在后续阶段接入</p>
        <button
          v-if="capabilities.mockPayment"
          class="btn-mock-pay"
          type="button"
          :disabled="mockPaying"
          @click="simulatePayment"
        >
          {{ mockPaying ? '模拟支付处理中...' : '🧪 开发模式：模拟支付成功' }}
        </button>
        <RouterLink to="/cart" class="btn-secondary">返回购物车</RouterLink>
      </div>
    </section>

    <section v-else-if="phase === 'expired'" class="card">
      <div class="pay-status-box">
        <div class="pay-status-icon">⌛</div>
        <div class="pay-status-title">订单已超时</div>
        <div class="pay-status-desc">预留库存已释放，请返回购物车重新结算。</div>
        <button class="btn-secondary" type="button" @click="restartCheckout">返回购物车</button>
      </div>
    </section>

    <section v-else class="card">
      <div class="pay-status-box">
        <div class="pay-status-icon">🎉</div>
        <div class="pay-status-title">支付成功！</div>
        <div class="pay-status-desc">付款结果已确认，可在“我的订单”中查看订单和生产进度。</div>
        <RouterLink :to="{ name: 'orders' }" class="btn-secondary">我的订单</RouterLink>
        <RouterLink to="/customize" class="btn-secondary">继续定制</RouterLink>
        <RouterLink to="/showcase" class="btn-secondary">看看联名作品</RouterLink>
      </div>
    </section>
  </main>

  <div class="checkout-toast" :class="{ show: toast }" role="status">{{ toast }}</div>
</template>
