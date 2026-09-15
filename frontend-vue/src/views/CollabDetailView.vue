<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppState from '@/components/AppState.vue'
import AuthDialog from '@/features/auth/AuthDialog.vue'
import { getCollabWork, recordCollabView } from '@/features/collab/api'
import CollabMediaGallery from '@/features/collab/CollabMediaGallery.vue'
import {
  clearCollabIntent,
  readCollabIntent,
  saveCollabIntent
} from '@/features/collab/purchase-intent'
import type { CollabMedia, CollabWorkDetail } from '@/features/collab/types'
import { useSessionStore } from '@/stores/session'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const work = ref<CollabWorkDetail | null>(null)
const selectedSkuId = ref('')
const quantity = ref(1)
const loading = ref(true)
const error = ref('')
const notice = ref('')
const authOpen = ref(false)
let viewTimer = 0
let noticeTimer = 0

const workId = computed(() => String(route.params.workId ?? ''))
const selectedSku = computed(
  () => work.value?.supportedSkus.find((sku) => sku.id === selectedSkuId.value) ?? null
)
const media = computed<CollabMedia[]>(() => {
  if (!work.value) return []
  const result = [...work.value.storefrontMedia]
  if (work.value.coverUrl && !result.some((item) => item.url === work.value?.coverUrl)) {
    result.unshift({ url: work.value.coverUrl, kind: 'image' })
  }
  return result
})

function showNotice(message: string): void {
  notice.value = message
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => {
    notice.value = ''
  }, 4500)
}

function visitorId(): string {
  const key = 'mowo_storefront_visitor'
  let value = localStorage.getItem(key) ?? ''
  if (!/^[A-Za-z0-9._-]{16,100}$/.test(value)) {
    value = crypto.randomUUID()
    localStorage.setItem(key, value)
  }
  return value
}

function scheduleView(): void {
  window.clearTimeout(viewTimer)
  viewTimer = window.setTimeout(() => {
    if (document.visibilityState === 'visible')
      void recordCollabView(workId.value, visitorId()).catch(() => undefined)
  }, 3000)
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  work.value = null
  try {
    const result = await getCollabWork(workId.value)
    work.value = result
    const requestedSku = typeof route.query.sku === 'string' ? route.query.sku : ''
    selectedSkuId.value = result.supportedSkus.some((sku) => sku.id === requestedSku)
      ? requestedSku
      : (result.supportedSkus[0]?.id ?? '')
    if (!requestedSku && selectedSkuId.value) {
      await router.replace({ query: { ...route.query, sku: selectedSkuId.value } })
    }
    scheduleView()
    restorePendingAction(false)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '联名商品详情暂时无法加载'
  } finally {
    loading.value = false
  }
}

async function selectSku(id: string): Promise<void> {
  selectedSkuId.value = id
  await router.replace({ query: { ...route.query, sku: id } })
}

function requestPurchasePreparation(): void {
  if (!selectedSku.value) return showNotice('请先选择一个规格')
  quantity.value = Math.max(1, Math.min(10, Number.isInteger(quantity.value) ? quantity.value : 1))
  const intent = {
    workId: workId.value,
    skuId: selectedSku.value.id,
    quantity: quantity.value,
    action: 'prepare-purchase' as const,
    createdAt: Date.now()
  }
  saveCollabIntent(intent)
  if (!session.isAuthenticated) {
    showNotice('登录后会恢复当前规格与操作')
    authOpen.value = true
    return
  }
  restorePendingAction(true)
}

function restorePendingAction(announce: boolean): void {
  const intent = readCollabIntent()
  if (!intent || intent.workId !== workId.value || !work.value) return
  if (!work.value.supportedSkus.some((sku) => sku.id === intent.skuId)) {
    clearCollabIntent()
    showNotice('原规格已不可用，请重新选择')
    return
  }
  selectedSkuId.value = intent.skuId
  quantity.value = intent.quantity
  void router.replace({ query: { ...route.query, sku: intent.skuId } })
  clearCollabIntent()
  if (announce) showNotice('已恢复原规格。购物车与在线交易将在 V3 验收后开放。')
}

function authenticated(): void {
  restorePendingAction(true)
}

watch(workId, load)
onMounted(load)
onBeforeUnmount(() => {
  window.clearTimeout(viewTimer)
  window.clearTimeout(noticeTimer)
})
</script>

<template>
  <main class="collab-detail-page page-width">
    <RouterLink class="collab-back" :to="{ name: 'collab-list' }">← 返回联名货架</RouterLink>
    <AppState v-if="loading" kind="loading" title="正在加载商品详情" />
    <AppState v-else-if="error || !work" kind="error" title="商品详情暂时无法显示" :detail="error">
      <RouterLink class="state-action" :to="{ name: 'collab-list' }">返回联名货架</RouterLink>
    </AppState>
    <template v-else>
      <div class="collab-detail-grid">
        <CollabMediaGallery :media="media" :title="work.title" />
        <section class="collab-product" aria-labelledby="product-title">
          <p class="section-kicker">{{ work.storefrontSeries || 'MOWO COLLAB' }}</p>
          <h1 id="product-title">{{ work.title }}</h1>
          <p class="collab-product__creator">与 {{ work.creator.nickname }} 联名</p>
          <p class="collab-product__summary">{{ work.storefrontSummary || work.description }}</p>
          <div v-if="work.storefrontTags.length" class="collab-tags">
            <span v-for="tag in work.storefrontTags" :key="tag">{{ tag }}</span>
          </div>

          <fieldset class="sku-picker">
            <legend>选择规格</legend>
            <button
              v-for="sku in work.supportedSkus"
              :key="sku.id"
              type="button"
              :class="{ active: selectedSkuId === sku.id }"
              @click="selectSku(sku.id)"
            >
              <strong>{{ sku.modelName }} · {{ sku.size }}</strong>
              <span>{{ sku.material }} · {{ sku.frameCount }} 帧</span>
              <b>¥{{ sku.finalPrice.toFixed(2) }}</b>
            </button>
          </fieldset>

          <dl v-if="selectedSku" class="sku-facts">
            <div>
              <dt>颜色</dt>
              <dd>{{ selectedSku.colorName || '默认颜色' }}</dd>
            </div>
            <div>
              <dt>供货方式</dt>
              <dd>
                {{
                  selectedSku.fulfillmentMode === 'STOCK_ONLY'
                    ? '仅限现货'
                    : '库存优先，无库存时安排制作'
                }}
              </dd>
            </div>
            <div>
              <dt>预计发出</dt>
              <dd>{{ selectedSku.leadTimeDays }} 天内</dd>
            </div>
          </dl>

          <div class="purchase-preparation">
            <label>
              <span>数量</span>
              <input v-model.number="quantity" type="number" min="1" max="10" />
            </label>
            <button class="primary-action" type="button" @click="requestPurchasePreparation">
              {{ session.isAuthenticated ? '保留选择，等待交易开放' : '登录并保留选择' }}
            </button>
          </div>
          <p class="transaction-boundary">
            当前未开放网页购物车与真实支付。本页不会创建订单、锁定库存或发起付款。
          </p>
        </section>
      </div>
      <section class="collab-description">
        <p class="section-kicker">ABOUT THE WORK</p>
        <h2>作品说明</h2>
        <p>{{ work.description || '创作者暂未填写更多作品说明。' }}</p>
      </section>
    </template>
    <p v-if="notice" class="collab-toast" role="status">{{ notice }}</p>
    <AuthDialog :open="authOpen" @close="authOpen = false" @authenticated="authenticated" />
  </main>
</template>
