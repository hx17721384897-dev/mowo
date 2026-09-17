<script setup lang="ts">
/* eslint-disable vue/html-closing-bracket-newline, vue/multiline-html-element-content-newline, vue/html-indent */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getCollabWork, getCollabWorks, recordCollabView } from '@/features/collab/api'
import CollabMediaGallery from '@/features/collab/CollabMediaGallery.vue'
import type { CollabMedia, CollabWorkDetail, CollabWorkSummary } from '@/features/collab/types'

const route = useRoute()
const router = useRouter()
const work = ref<CollabWorkDetail | null>(null)
const related = ref<CollabWorkSummary[]>([])
const selectedSkuId = ref('')
const quantity = ref(1)
const loading = ref(true)
const error = ref('')
const failedSkuImages = ref(new Set<string>())
const failedRelatedImages = ref(new Set<string>())
let viewTimer = 0
let requestSequence = 0

const workId = computed(() => String(route.params.workId ?? ''))
const selectedSku = computed(
  () => work.value?.supportedSkus.find((sku) => sku.id === selectedSkuId.value) ?? null
)
const media = computed<CollabMedia[]>(() => {
  if (!work.value) return []
  const result: CollabMedia[] = []
  const seen = new Set<string>()
  const add = (item: CollabMedia): void => {
    if (!item.url || seen.has(item.url)) return
    seen.add(item.url)
    result.push(item)
  }
  if (work.value.coverUrl) add({ url: work.value.coverUrl, kind: 'image' })
  work.value.storefrontMedia.forEach(add)
  return result
})
const creatorName = computed(() => work.value?.creator.nickname || '创作者')
const selectionText = computed(() => {
  const sku = selectedSku.value
  if (!sku) return '请选择规格'
  return `${sku.modelName} · ${sku.size} · ${sku.frameCount}帧 · ${sku.material} · ${sku.colorName || '默认颜色'} · ${quantity.value} 件`
})

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
async function loadRelated(sequence: number): Promise<void> {
  try {
    const result = await getCollabWorks({ page: 1, limit: 8, sort: 'recommended' })
    if (sequence === requestSequence)
      related.value = result.works.filter((item) => item.id !== workId.value).slice(0, 4)
  } catch {
    if (sequence === requestSequence) related.value = []
  }
}
async function load(): Promise<void> {
  const sequence = ++requestSequence
  loading.value = true
  error.value = ''
  work.value = null
  related.value = []
  failedSkuImages.value = new Set()
  failedRelatedImages.value = new Set()
  try {
    if (!workId.value) throw new Error('缺少商品编号，请返回联名作品列表重新选择')
    const result = await getCollabWork(workId.value)
    if (sequence !== requestSequence) return
    work.value = result
    const requestedSku = typeof route.query.sku === 'string' ? route.query.sku : ''
    selectedSkuId.value = result.supportedSkus.some((sku) => sku.id === requestedSku)
      ? requestedSku
      : (result.supportedSkus[0]?.id ?? '')
    if (!requestedSku && selectedSkuId.value)
      await router.replace({ query: { ...route.query, sku: selectedSkuId.value } })
    document.title = `${result.title} - 哞屋 MOWO`
    scheduleView()
    void loadRelated(sequence)
  } catch (cause) {
    if (sequence !== requestSequence) return
    error.value = cause instanceof Error ? cause.message : '商品详情暂时无法加载，请稍后重试'
  } finally {
    if (sequence === requestSequence) loading.value = false
  }
}
async function selectSku(id: string): Promise<void> {
  selectedSkuId.value = id
  await router.replace({ query: { ...route.query, sku: id } })
}
function changeQuantity(delta: number): void {
  setQuantity(quantity.value + delta)
}
function setQuantity(value: number | string): void {
  quantity.value = Math.max(1, Math.min(10, Number.parseInt(String(value), 10) || 1))
}
function safeColor(value: string | null): string {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value ?? '')
    ? value!
    : '#eee'
}
function formatPrice(value: number | null | undefined): string {
  return Number.isFinite(Number(value)) ? `¥${Number(value).toFixed(2)}` : '暂不可售'
}
function fulfillment(short = false): string {
  if (!selectedSku.value) return ''
  if (short) return selectedSku.value.fulfillmentMode === 'STOCK_ONLY' ? '库存款' : '可安排制作'
  return selectedSku.value.fulfillmentMode === 'STOCK_ONLY'
    ? '仅限现货'
    : '库存优先，无库存时安排制作'
}
function markSkuImageFailed(id: string): void {
  failedSkuImages.value = new Set(failedSkuImages.value).add(id)
}
function markRelatedImageFailed(id: string): void {
  failedRelatedImages.value = new Set(failedRelatedImages.value).add(id)
}

watch(workId, load)
onMounted(load)
onBeforeUnmount(() => {
  requestSequence += 1
  window.clearTimeout(viewTimer)
})
</script>

<template>
  <div class="collab-detail-fidelity">
    <div class="shell">
      <div class="crumb">
        <RouterLink :to="{ name: 'collab-list' }">联名作品</RouterLink><span>/</span
        ><span>{{ work?.title || '商品详情' }}</span>
      </div>
      <main>
        <div v-if="loading" class="loading">正在读取商品信息...</div>
        <div v-else-if="error || !work" class="error-state">
          <strong>{{ error || '商品不存在或已经下架' }}</strong
          ><RouterLink :to="{ name: 'collab-list' }">返回联名作品</RouterLink>
        </div>
        <div v-else class="product">
          <CollabMediaGallery
            :media="media"
            :animation-frames="work.animationFrames"
            :title="work.title"
          />
          <section class="info">
            <div class="series">{{ work.storefrontSeries || '哞屋联名作品' }}</div>
            <h1 class="title">{{ work.title }}</h1>
            <p class="summary">{{ work.storefrontSummary || '' }}</p>
            <div v-if="work.storefrontTags.length" class="tags">
              <span v-for="tag in work.storefrontTags" :key="tag" class="tag">{{ tag }}</span>
            </div>
            <RouterLink
              class="creator"
              :to="{ name: 'collab-list', query: { creatorId: work.creatorId } }"
              ><span class="creator-avatar"
                ><img
                  v-if="work.creator.avatarUrl"
                  :src="work.creator.avatarUrl"
                  :alt="creatorName"
                />{{ work.creator.avatarUrl ? '' : creatorName.charAt(0) }}</span
              ><span
                ><span class="creator-label">联名创作者</span
                ><span class="creator-name">{{ creatorName }}</span></span
              ></RouterLink
            >
            <div class="price-line">
              <span class="price">{{ formatPrice(selectedSku?.finalPrice) }}</span
              ><span class="price-note">按所选款式计价</span>
            </div>
            <div class="section-label">选择完整款式</div>
            <div class="sku-list">
              <button
                v-for="sku in work.supportedSkus"
                :key="sku.id"
                class="sku-card"
                :class="{ selected: selectedSkuId === sku.id }"
                type="button"
                @click="selectSku(sku.id)"
              >
                <span class="sku-image"
                  ><img
                    v-if="sku.previewImage && !failedSkuImages.has(sku.id)"
                    :src="sku.previewImage"
                    alt=""
                    @error="markSkuImageFailed(sku.id)"
                  /><template v-else>暂无图</template></span
                >
                <span
                  ><span class="sku-name"
                    >{{ sku.modelName }} · {{ sku.size }} · {{ sku.frameCount }}帧</span
                  ><span class="sku-meta"
                    >{{ sku.material }} ·
                    <span class="swatch" :style="{ background: safeColor(sku.colorHex) }" />{{
                      sku.colorName || '默认颜色'
                    }}</span
                  ><span class="sku-delivery"
                    >{{ sku.fulfillmentMode === 'STOCK_ONLY' ? '库存款' : '可安排制作' }} · 预计
                    {{ sku.leadTimeDays }} 天内发出</span
                  ></span
                >
                <span class="sku-price">{{ formatPrice(sku.finalPrice) }}</span>
              </button>
            </div>
            <div class="quantity">
              <b>数量</b>
              <div class="stepper">
                <button type="button" aria-label="减少数量" @click="changeQuantity(-1)">-</button
                ><input
                  :value="quantity"
                  inputmode="numeric"
                  aria-label="购买数量"
                  @change="setQuantity(($event.target as HTMLInputElement).value)"
                /><button type="button" aria-label="增加数量" @click="changeQuantity(1)">+</button>
              </div>
            </div>
            <div class="actions single-action">
              <RouterLink class="action buy cta" to="/contact"
                >联系工作人员了解邀请测试订购安排</RouterLink
              >
            </div>
            <div class="selection-hint" />
          </section>
        </div>
      </main>
    </div>

    <template v-if="work && !loading">
      <section class="detail-band">
        <div class="detail-inner">
          <h2 class="detail-title">商品详情</h2>
          <div class="detail-copy">{{ work.description || '' }}</div>
          <div v-if="selectedSku" class="spec-table">
            <div
              v-for="row in [
                ['款式', selectedSku.modelName],
                ['尺寸', selectedSku.size],
                ['产品帧数', `${selectedSku.frameCount} 帧`],
                ['材质', selectedSku.material],
                ['颜色', selectedSku.colorName || '默认颜色'],
                ['供货方式', fulfillment()],
                ['预计发出', `${selectedSku.leadTimeDays} 天内`]
              ]"
              :key="row[0]"
              class="spec-row"
            >
              <span class="spec-key">{{ row[0] }}</span
              ><span class="spec-value">{{ row[1] }}</span>
            </div>
          </div>
        </div>
      </section>
      <section v-if="related.length" class="more">
        <div class="more-head">
          <h2>更多联名作品</h2>
          <RouterLink :to="{ name: 'collab-list' }">查看全部</RouterLink>
        </div>
        <div class="more-grid">
          <RouterLink
            v-for="item in related"
            :key="item.id"
            class="more-card"
            :to="{ name: 'collab-detail', params: { workId: item.id } }"
            ><div class="more-image">
              <img
                v-if="item.coverUrl && !failedRelatedImages.has(item.id)"
                :src="item.coverUrl"
                alt=""
                @error="markRelatedImageFailed(item.id)"
              />
            </div>
            <div class="more-body">
              <div class="more-title">{{ item.title }}</div>
              <div class="more-price">{{ formatPrice(item.minPrice) }} 起</div>
            </div></RouterLink
          >
        </div>
      </section>
    </template>

    <div class="purchase-bar" hidden>
      <div class="purchase-inner">
        <div class="bar-summary">
          <div class="bar-title">{{ work?.title }}</div>
          <div class="bar-choice">{{ selectionText }}</div>
        </div>
        <div class="bar-price">{{ formatPrice(selectedSku?.finalPrice) }}</div>
      </div>
    </div>
  </div>
</template>
