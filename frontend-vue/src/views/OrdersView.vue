<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { confirmOrderReceipt, getMyOrders } from '@/features/transaction/api'
import OrderProgress from '@/features/transaction/OrderProgress.vue'
import {
  orderEta,
  orderProgressVisible,
  orderStatusClass
} from '@/features/transaction/order-presentation'
import type { OrderViewModel } from '@/features/transaction/types'
import { toOrderViewModel } from '@/features/transaction/view-model'
import '@/features/transaction/orders.css'

const tab = ref<'active' | 'all'>('active')
const status = ref('all')
const searchInput = ref('')
const search = ref('')
const orders = ref<OrderViewModel[]>([])
const activeCount = ref(0)
const totalCount = ref(0)
const page = ref(1)
const hasMore = ref(false)
const loading = ref(true)
const loadingMore = ref(false)
const error = ref('')
const actionOrder = ref<OrderViewModel | null>(null)
const actionBusy = ref(false)
const toast = ref('')
let loadSequence = 0
let toastTimer: ReturnType<typeof setTimeout> | undefined

function notify(message: string): void {
  toast.value = message
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.value = ''
  }, 3000)
}

async function load(nextPage = 1): Promise<void> {
  if (nextPage > 1 && (loadingMore.value || !hasMore.value)) return
  const sequence = ++loadSequence
  const selectedTab = tab.value
  const selectedStatus = status.value
  const selectedSearch = search.value
  if (nextPage === 1) {
    loading.value = true
    error.value = ''
  } else loadingMore.value = true
  try {
    const result = await getMyOrders(selectedTab, nextPage, 30, selectedStatus, selectedSearch)
    if (
      sequence !== loadSequence ||
      selectedTab !== tab.value ||
      selectedStatus !== status.value ||
      selectedSearch !== search.value
    )
      return
    const incoming = result.orders.map(toOrderViewModel)
    error.value = ''
    orders.value = nextPage === 1 ? incoming : [...orders.value, ...incoming]
    activeCount.value = result.activeCount
    totalCount.value = result.totalCount
    page.value = result.page
    hasMore.value = result.hasMore
  } catch (cause) {
    if (sequence !== loadSequence) return
    error.value = cause instanceof Error ? cause.message : '订单加载失败'
  } finally {
    if (sequence === loadSequence) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

function selectTab(value: 'active' | 'all'): void {
  if (tab.value === value) return
  tab.value = value
  orders.value = []
  load()
}

function applyFilters(): void {
  search.value = searchInput.value.trim()
  orders.value = []
  void load()
}

function selectStatus(event: Event): void {
  status.value = (event.target as HTMLSelectElement).value
  if (['received', 'aftersale', 'cancelled'].includes(status.value)) tab.value = 'all'
  applyFilters()
}

async function copyTracking(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    notify('✓ 快递单号已复制')
  } catch {
    notify(`快递单号：${value}`)
  }
}

async function confirmReceipt(): Promise<void> {
  const order = actionOrder.value
  if (!order || actionBusy.value || !order.actions.canConfirmReceipt) return
  actionBusy.value = true
  try {
    await confirmOrderReceipt(order.id)
    actionOrder.value = null
    notify('✓ 已确认收货，感谢您的支持！')
    await load()
  } catch (cause) {
    notify(cause instanceof Error ? cause.message : '确认收货失败')
  } finally {
    actionBusy.value = false
  }
}

onMounted(() => load())
onBeforeUnmount(() => {
  if (toastTimer) clearTimeout(toastTimer)
})
</script>

<template>
  <main class="orders-page">
    <header class="page-header">
      <h1 class="page-title">我的<em>订单</em></h1>
    </header>
    <div class="tab-bar" role="tablist" aria-label="订单筛选">
      <button
        class="tab-btn"
        :class="{ active: tab === 'active', 'has-active': activeCount > 0 }"
        role="tab"
        :aria-selected="tab === 'active'"
        @click="selectTab('active')"
      >
        进行中 <span class="tab-badge">{{ activeCount }}</span>
      </button>
      <button
        class="tab-btn"
        :class="{ active: tab === 'all' }"
        role="tab"
        :aria-selected="tab === 'all'"
        @click="selectTab('all')"
      >
        全部订单 <span class="tab-badge">{{ totalCount }}</span>
      </button>
    </div>
    <form class="order-filters" role="search" @submit.prevent="applyFilters">
      <label class="filter-label" for="order-status">订单状态</label>
      <select id="order-status" :value="status" @change="selectStatus">
        <option value="all">全部状态</option>
        <option value="pending">待付款</option>
        <option value="paid">已付款</option>
        <option value="producing">制作中</option>
        <option value="shipped">运输中</option>
        <option value="received">已完成</option>
        <option value="aftersale">售后中</option>
        <option value="cancelled">已取消／已超时</option>
      </select>
      <label class="filter-label" for="order-search">搜索订单</label>
      <input
        id="order-search"
        v-model="searchInput"
        maxlength="80"
        placeholder="订单编号或商品名称"
      />
      <button type="submit">搜索</button>
    </form>
    <div v-if="loading" class="order-list" aria-live="polite">
      <div v-for="i in 3" :key="i" class="skeleton-card">
        <div class="sk" style="height: 42px"></div>
        <div class="sk" style="height: 104px; margin: 18px"></div>
      </div>
    </div>
    <div v-else-if="error && !orders.length" class="error-state">
      <div class="error-icon">😔</div>
      <div class="error-title">加载失败</div>
      <p class="error-desc">{{ error }}</p>
      <button class="btn-retry" @click="load()">重新加载</button>
    </div>
    <div v-else-if="!orders.length" class="empty">
      <div class="empty-icon">📭</div>
      <div class="empty-title">这里还没有订单</div>
      <p class="empty-desc">
        {{ search || status !== 'all' ? '请试试其他搜索词或状态' : '下单后可在这里查看订单' }}
      </p>
      <RouterLink v-if="!search && status === 'all'" to="/showcase" class="btn-go"
        >浏览商品 →</RouterLink
      >
    </div>
    <template v-else>
      <div class="order-list">
        <article v-for="order in orders" :key="order.id" class="order-card">
          <div class="card-head">
            <span class="order-no"
              >{{ order.kind === 'pre_order' ? '付款前编号' : 'NO.' }} {{ order.orderNo }}</span
            ><span class="order-date">{{
              new Date(order.createdAt).toLocaleDateString('zh-CN', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              })
            }}</span
            ><span class="status-pill" :class="orderStatusClass(order)">{{
              order.displayStatus
            }}</span>
          </div>
          <div class="card-body">
            <OrderProgress v-if="orderProgressVisible(order)" :order="order" />
            <button
              v-if="order.trackingNo && order.status === 'shipped'"
              class="eta-row"
              @click="copyTracking(order.trackingNo)"
            >
              <span class="eta-icon">📦</span
              ><span class="eta-text"
                >{{ order.trackingCompany || '快递' }} {{ order.trackingNo }}</span
              ><span class="eta-copy">复制</span>
            </button>
            <div v-else-if="orderEta(order)" class="eta-row">
              <span class="eta-icon">{{ order.status === 'shipped' ? '🚚' : '🔧' }}</span
              ><span class="eta-text">{{ orderEta(order) }}</span>
            </div>
            <div
              v-if="order.kind === 'pre_order' && order.status === 'pending' && order.expiresAt"
              class="eta-row"
            >
              <span class="eta-icon">⏳</span
              ><span class="eta-text"
                >付款截止：{{
                  new Date(order.expiresAt).toLocaleString('zh-CN', { hour12: false })
                }}</span
              >
            </div>
            <div v-for="item in order.items" :key="item.id" class="items-row">
              <div class="item-thumb">
                <img v-if="item.coverUrl" :src="item.coverUrl" alt="" loading="lazy" /><span
                  v-else
                  >{{ item.itemType === 'MARKET' ? '🎬' : '🎨' }}</span
                >
              </div>
              <div class="item-info-col">
                <div class="item-title-sm">{{ item.productTitle }}</div>
                <div class="item-machine-sm">
                  ⚙ {{ item.specificationText }} · 数量 {{ item.quantity }}
                </div>
              </div>
              <div class="item-total">{{ item.lineTotalText }}</div>
            </div>
            <div v-if="order.items.length > 1" class="order-sum">
              订单合计 {{ order.totalAmountText }}
            </div>
            <div class="card-actions">
              <RouterLink
                v-if="
                  order.kind === 'pre_order' &&
                  order.status === 'pending' &&
                  order.actions.canCancel
                "
                class="btn-action yellow"
                :to="{ name: 'checkout', query: { preOrderId: order.id.slice(4) } }"
                >继续付款</RouterLink
              >
              <button
                v-if="order.actions.canConfirmReceipt"
                class="btn-action yellow"
                @click="actionOrder = order"
              >
                确认收货</button
              ><RouterLink
                class="btn-action primary"
                :to="{ name: 'order-detail', params: { id: order.id } }"
                >查看详情</RouterLink
              >
            </div>
          </div>
        </article>
      </div>
      <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
      <button
        v-if="hasMore"
        class="btn-retry load-more"
        :disabled="loadingMore"
        @click="load(page + 1)"
      >
        {{ loadingMore ? '加载中…' : '加载更多' }}
      </button>
    </template>
    <div
      v-if="actionOrder"
      class="order-modal-bg"
      @click.self="!actionBusy && (actionOrder = null)"
    >
      <div class="order-modal" role="dialog" aria-modal="true" aria-labelledby="receipt-title">
        <div class="modal-icon">📦</div>
        <h2 id="receipt-title">确认收货</h2>
        <p>确认已收到商品？确认后订单将进入已完成状态。</p>
        <div class="modal-buttons">
          <button :disabled="actionBusy" @click="actionOrder = null">返回</button
          ><button class="strong" :disabled="actionBusy" @click="confirmReceipt">
            {{ actionBusy ? '处理中…' : '确认收货' }}
          </button>
        </div>
      </div>
    </div>
    <div v-if="toast" class="order-toast" role="status">{{ toast }}</div>
  </main>
</template>
