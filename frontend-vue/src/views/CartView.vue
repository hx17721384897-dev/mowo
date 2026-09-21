<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  confirmAllCartPriceChanges,
  getCart,
  removeCartItem,
  updateCartItem
} from '@/features/transaction/api'
import type { CartItemType, CartItemViewModel, CartViewModel } from '@/features/transaction/types'
import { toCartViewModel } from '@/features/transaction/view-model'
import '@/features/transaction/cart.css'

type CartTab = 'all' | 'custom' | 'market'

interface CartGroup {
  id: string
  type: CartItemType
  label: string
  subLabel: string | null
  previewUrl: string | null
  creatorAvatar: string | null
  items: CartItemViewModel[]
}

const router = useRouter()
const cart = ref<CartViewModel | null>(null)
const loading = ref(true)
const error = ref('')
const tab = ref<CartTab>('all')
const modalOpen = ref(false)
const busy = ref(false)
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | undefined

const groups = computed<CartGroup[]>(() => {
  const grouped = new Map<string, CartGroup>()
  for (const item of cart.value?.items ?? []) {
    const id =
      item.itemType === 'CUSTOM'
        ? `c_${item.sessionGroupId || item.customProductId || item.id}`
        : `m_${item.creatorId || item.contentId || item.id}`
    let group = grouped.get(id)
    if (!group) {
      const modelName = item.specificationText?.split(' · ')[0]
      group = {
        id,
        type: item.itemType,
        label:
          item.itemType === 'CUSTOM'
            ? `我的定制${modelName ? ` · ${modelName}` : ''}`
            : item.creator?.nickname || '未知创作者',
        subLabel: null,
        previewUrl: item.coverUrl || item.snapshotPreviewUrl,
        creatorAvatar: item.creator?.avatarUrl ?? null,
        items: []
      }
      grouped.set(id, group)
    }
    group.items.push(item)
  }
  const result = [...grouped.values()]
  for (const group of result) {
    if (group.type === 'CUSTOM') group.subLabel = `${group.items.length} 款配置`
  }
  return result.sort((left, right) => {
    if (left.type === right.type) return 0
    return left.type === 'CUSTOM' ? -1 : 1
  })
})

const visibleGroups = computed(() =>
  groups.value.filter((group) => {
    if (tab.value === 'custom') return group.type === 'CUSTOM'
    if (tab.value === 'market') return group.type === 'MARKET'
    return true
  })
)
const selectedItems = computed(
  () => cart.value?.items.filter((item) => item.selected && item.selectable) ?? []
)
const selectedEntryCount = computed(
  () => cart.value?.items.filter((item) => item.selected).length ?? 0
)
const allSelected = computed(() =>
  Boolean(cart.value?.items.length && cart.value.items.every((item) => item.selected))
)
const partiallySelected = computed(() => selectedEntryCount.value > 0 && !allSelected.value)
const checkoutBlockedByPrice = computed(() => selectedItems.value.some((item) => item.priceChanged))

function showToast(message: string): void {
  toast.value = message
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 2600)
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    cart.value = toCartViewModel(await getCart())
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '购物车加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

async function mutate(action: () => Promise<void>, success?: string): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    await action()
    await load()
    if (success) showToast(success)
  } catch (cause) {
    showToast(cause instanceof Error ? cause.message : '操作失败，请稍后重试')
  } finally {
    busy.value = false
  }
}

function groupSelection(group: CartGroup): 'all' | 'partial' | 'none' {
  const count = group.items.filter((item) => item.selected).length
  if (count === group.items.length) return 'all'
  return count > 0 ? 'partial' : 'none'
}

async function toggleItem(item: CartItemViewModel): Promise<void> {
  if (!item.selectable) return
  await mutate(() => updateCartItem(item.id, { selected: !item.selected }))
}

async function toggleGroup(group: CartGroup): Promise<void> {
  const selected = groupSelection(group) === 'all'
  await mutate(() =>
    Promise.all(
      group.items
        .filter((item) => item.selectable)
        .map((item) => updateCartItem(item.id, { selected: !selected }))
    ).then(() => undefined)
  )
}

async function toggleAll(): Promise<void> {
  const selected = allSelected.value
  await mutate(() =>
    Promise.all(
      (cart.value?.items ?? [])
        .filter((item) => item.selectable)
        .map((item) => updateCartItem(item.id, { selected: !selected }))
    ).then(() => undefined)
  )
}

async function changeQuantity(item: CartItemViewModel, delta: number): Promise<void> {
  const quantity = Math.min(10, Math.max(1, item.quantity + delta))
  if (quantity === item.quantity) return
  await mutate(() => updateCartItem(item.id, { quantity }))
}

async function deleteItem(itemId: string): Promise<void> {
  await mutate(() => removeCartItem(itemId), '已移除')
}

async function batchDelete(): Promise<void> {
  const ids = cart.value?.items.filter((item) => item.selected).map((item) => item.id) ?? []
  if (!ids.length) return
  await mutate(() => Promise.all(ids.map(removeCartItem)).then(() => undefined), '已删除所选商品')
}

async function confirmPrices(): Promise<void> {
  await mutate(confirmAllCartPriceChanges, '已确认最新价格')
}

function itemTitle(item: CartItemViewModel): string {
  if (item.itemType !== 'CUSTOM' || !item.specificationText) return item.snapshotTitle
  return `定制款 · ${item.specificationText.replaceAll(' · ', ' ')}`
}

function openCheckout(): void {
  if (!cart.value?.canCheckout) return
  modalOpen.value = true
  document.body.style.overflow = 'hidden'
}

function closeCheckout(): void {
  modalOpen.value = false
  document.body.style.overflow = ''
}

function goCheckout(): void {
  const ids = selectedItems.value.map((item) => item.id)
  if (!ids.length || checkoutBlockedByPrice.value) return
  sessionStorage.setItem('mowo_checkout_items', JSON.stringify(ids))
  closeCheckout()
  void router.push('/checkout')
}

function handleEscape(event: KeyboardEvent): void {
  if (event.key === 'Escape' && modalOpen.value) closeCheckout()
}

onMounted(() => {
  document.addEventListener('keydown', handleEscape)
  void load()
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleEscape)
  document.body.style.overflow = ''
  if (toastTimer) clearTimeout(toastTimer)
})
</script>

<template>
  <main class="cart-page">
    <div class="page-header reveal on">
      <h1 class="page-title">购物车 <em>🛒</em></h1>
      <p class="page-sub">勾选商品，确认机型，随时结算</p>
    </div>

    <div v-if="loading" class="cart-loading" aria-live="polite">正在加载购物车…</div>
    <div v-else-if="error" class="empty-state" role="alert">
      <div class="empty-icon">⚠️</div>
      <div class="empty-title">购物车加载失败</div>
      <div class="empty-desc">{{ error }}</div>
      <button class="btn-go" type="button" @click="load">重新加载</button>
    </div>
    <div v-else-if="!cart?.items.length" class="empty-state">
      <div class="empty-icon">🛒</div>
      <div class="empty-title">购物车还是空的</div>
      <div class="empty-desc">在定制流程选配好框架后加入购物车<br />或在联名展示页选喜欢的作品</div>
      <RouterLink to="/customize" class="btn-go">去定制 →</RouterLink>
    </div>

    <div v-else>
      <div class="cart-tabs reveal on d1" role="tablist" aria-label="购物车商品分类">
        <button
          v-for="option in [
            { value: 'all', label: '全部' },
            { value: 'custom', label: '✏️ 定制款' },
            { value: 'market', label: '🎨 联名款' }
          ] as const"
          :key="option.value"
          class="tab-btn"
          :class="{ active: tab === option.value }"
          type="button"
          role="tab"
          :aria-selected="tab === option.value"
          @click="tab = option.value"
        >
          {{ option.label }}
        </button>
      </div>

      <div class="cart-layout">
        <div>
          <div class="toolbar reveal on d1">
            <button
              class="chk"
              :class="{ on: allSelected, partial: partiallySelected }"
              type="button"
              aria-label="全选"
              :disabled="busy"
              @click="toggleAll"
            ></button>
            <button class="sel-all-label" type="button" :disabled="busy" @click="toggleAll">
              全选
            </button>
            <span class="sel-info">已选 {{ selectedEntryCount }} 件</span>
            <button
              class="btn-batch-del"
              type="button"
              :disabled="busy || selectedEntryCount === 0"
              @click="batchDelete"
            >
              删除所选
            </button>
          </div>

          <div class="cart-list reveal on d2">
            <article
              v-for="group in visibleGroups"
              :key="group.id"
              class="cart-group"
              :class="{ 'has-sel': group.items.some((item) => item.selected) }"
            >
              <div class="group-header">
                <div v-if="group.type === 'CUSTOM'" class="group-thumb">
                  <img v-if="group.previewUrl" :src="group.previewUrl" alt="" />
                  <span v-else>✏️</span><span class="diy-badge">DIY</span>
                </div>
                <div v-else class="creator-av">
                  <img v-if="group.creatorAvatar" :src="group.creatorAvatar" alt="" />
                  <span v-else>🎨</span>
                </div>
                <div class="group-label">
                  <div class="group-label-main">{{ group.label }}</div>
                  <div v-if="group.subLabel" class="group-label-sub">{{ group.subLabel }}</div>
                </div>
                <button
                  class="chk"
                  :class="{
                    on: groupSelection(group) === 'all',
                    partial: groupSelection(group) === 'partial'
                  }"
                  type="button"
                  :aria-label="`选择${group.label}分组`"
                  :disabled="busy"
                  @click="toggleGroup(group)"
                ></button>
              </div>

              <div
                v-for="item in group.items"
                :key="item.id"
                class="child-item"
                :class="{ sel: item.selected, invalid: !item.selectable }"
              >
                <button
                  class="child-chk"
                  :class="{ on: item.selected }"
                  type="button"
                  :aria-label="`选择${itemTitle(item)}`"
                  :disabled="busy || !item.selectable"
                  @click="toggleItem(item)"
                ></button>
                <div class="child-info">
                  <div class="child-title">{{ itemTitle(item) }}</div>
                  <span
                    v-if="item.statusText"
                    class="child-tag"
                    :class="item.priceChanged ? 'price' : 'warn'"
                  >
                    {{ item.statusText }}
                  </span>
                  <div class="child-prices">
                    <span class="child-unit">{{ item.unitPriceText }}/件</span>
                    <span class="child-sub">{{ item.lineTotalText }}</span>
                  </div>
                </div>
                <div class="child-right">
                  <div class="qty-row">
                    <button
                      class="qty-btn"
                      type="button"
                      :disabled="busy || item.quantity <= 1"
                      @click="changeQuantity(item, -1)"
                    >
                      −
                    </button>
                    <span class="qty-n">{{ item.quantity }}</span>
                    <button
                      class="qty-btn"
                      type="button"
                      :disabled="busy || item.quantity >= 10"
                      @click="changeQuantity(item, 1)"
                    >
                      +
                    </button>
                  </div>
                  <button
                    class="btn-del"
                    type="button"
                    :disabled="busy"
                    @click="deleteItem(item.id)"
                  >
                    删除
                  </button>
                </div>
              </div>
            </article>
          </div>
        </div>

        <aside class="summary reveal on d1">
          <div class="sum-title">订单摘要</div>
          <div class="sum-items">
            <div v-for="item in selectedItems" :key="item.id" class="sum-item">
              <div class="sum-ic">{{ item.itemType === 'CUSTOM' ? '✏️' : '🎨' }}</div>
              <span class="sum-name">{{ itemTitle(item) }} ×{{ item.quantity }}</span>
              <span class="sum-price">{{ item.lineTotalText }}</span>
            </div>
            <div v-if="!selectedItems.length" class="sum-hint">勾选左侧商品后显示</div>
          </div>
          <div class="sum-row">
            <span>商品合计</span><span>{{ cart?.totalPriceText }}</span>
          </div>
          <div class="sum-row">
            <span>件数</span><span>{{ cart?.totalSelected }} 件</span>
          </div>
          <div class="sum-row total">
            <span>总计</span><span>{{ cart?.totalPriceText }}</span>
          </div>
          <button
            v-if="checkoutBlockedByPrice"
            class="btn-confirm-price"
            type="button"
            :disabled="busy"
            @click="confirmPrices"
          >
            确认最新价格
          </button>
          <button
            class="btn-checkout"
            type="button"
            :disabled="busy || !cart?.canCheckout"
            @click="openCheckout"
          >
            去结算
          </button>
          <button class="btn-back-fav" type="button" @click="router.push('/customize')">
            ← 继续定制
          </button>
        </aside>
      </div>
    </div>
  </main>

  <div class="modal-bg" :class="{ open: modalOpen }" @click.self="closeCheckout">
    <div class="confirm-box" role="dialog" aria-modal="true" aria-labelledby="cart-confirm-title">
      <div class="cfm-icon">🛍️</div>
      <div id="cart-confirm-title" class="cfm-title">确认前往结算</div>
      <div class="cfm-desc">以下商品即将进入结算流程，<br />请确认数量和机型无误。</div>
      <div class="cfm-sum">
        <div class="cfm-row">
          <span>商品件数</span><span>{{ cart?.totalSelected }} 件</span>
        </div>
        <div class="cfm-row"><span>配送方式</span><span>快递包邮</span></div>
        <div class="cfm-row">
          <span>应付总额</span><span>{{ cart?.totalPriceText }}</span>
        </div>
      </div>
      <div class="cfm-btns">
        <button class="btn-cfm-cancel" type="button" @click="closeCheckout">再想想</button>
        <button class="btn-cfm-go" type="button" @click="goCheckout">确认结算 →</button>
      </div>
    </div>
  </div>

  <div class="toast" :class="{ show: toast }" role="status">{{ toast }}</div>
</template>
