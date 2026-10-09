<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AdminSidebar from '@/components/AdminSidebar.vue'
import { safeImageUrl } from '@/shared/media/safe-image-url'
import {
  getProductHistory,
  getProductWorkspace,
  publishProductWorkspace,
  saveProductWorkspace,
  uploadStorefrontMedia,
  type FulfillmentMode,
  type ProductCandidate,
  type ProductHistory,
  type ProductMedia,
  type ProductPayload,
  type ProductSelection,
  type ProductWorkspace
} from '@/features/admin-collab-product/api'
import './admin-collab-product.css'

type Issue = {
  group: 'content' | 'asset' | 'sale'
  message: string
  target: string
  blockSave?: boolean
}
const route = useRoute()
const router = useRouter()
const workId = String(route.params.id || '')
const mobileOpen = ref(false)
const collapsed = ref(false)
const workspace = ref<ProductWorkspace | null>(null)
const rows = ref<ProductSelection[]>([])
const media = ref<ProductMedia[]>([])
const history = ref<ProductHistory[]>([])
const loading = ref(true)
const loadError = ref('')
const historyError = ref(false)
const busy = ref(false)
const previewOpen = ref(false)
const notice = ref('')
const title = ref('')
const series = ref('')
const summary = ref('')
const description = ref('')
const tags = ref('')
const keywords = ref('')
const sortOrder = ref('0')
const coverKey = ref('')
const skuSearch = ref('')
const sizeFilter = ref('')
const frameFilter = ref('')
const showIncompatible = ref(false)
const bulkMode = ref<FulfillmentMode>('MAKE_TO_ORDER')
const bulkDays = ref('7')
const bulkMarkup = ref('0')
const uploadInput = ref<HTMLInputElement | null>(null)
let noticeTimer: number | undefined
const ownedObjectUrls = new Set<string>()
const candidates = computed(() => workspace.value?.candidates || [])
const candidateMap = computed(
  () => new Map(candidates.value.map((candidate) => [candidate.id, candidate]))
)
const selectedMap = computed(() => new Map(rows.value.map((row) => [row.skuId, row])))
const sizes = computed(() => [...new Set(candidates.value.map((candidate) => candidate.size))])
const frames = computed(() =>
  [...new Set(candidates.value.map((candidate) => candidate.frameCount))].sort((a, b) => a - b)
)
const orderedCandidates = computed(() =>
  [
    ...rows.value
      .map((row) => candidateMap.value.get(row.skuId))
      .filter((candidate): candidate is ProductCandidate => !!candidate),
    ...candidates.value.filter((candidate) => !selectedMap.value.has(candidate.id))
  ].filter(
    (candidate) =>
      (showIncompatible.value || candidate.compatible || selectedMap.value.has(candidate.id)) &&
      (!sizeFilter.value || candidate.size === sizeFilter.value) &&
      (!frameFilter.value || String(candidate.frameCount) === frameFilter.value) &&
      (!skuSearch.value.trim() ||
        `${candidate.skuCode} ${candidate.modelName} ${candidate.material} ${candidate.colorName}`
          .toLowerCase()
          .includes(skuSearch.value.trim().toLowerCase()))
  )
)
const enabledRows = computed(() => rows.value.filter((row) => row.isEnabled))
const tagsValue = computed(() =>
  tags.value
    .split(/[,，]/)
    .map((value) => value.trim())
    .filter(Boolean)
)
const issues = computed<Issue[]>(() => {
  const data = workspace.value
  if (!data) return []
  const result: Issue[] = []
  const add = (group: Issue['group'], message: string, target: string, blockSave = false) =>
    result.push({ group, message, target, blockSave })
  if (title.value.trim().length < 2)
    add('content', '商品标题至少填写 2 个字', 'storefrontTitle', true)
  if (title.value.length > 120) add('content', '商品标题不能超过 120 个字', 'storefrontTitle', true)
  if (!summary.value.trim()) add('content', '请填写列表卖点简介', 'storefrontSummary')
  if (summary.value.length > 300)
    add('content', '列表卖点简介不能超过 300 个字', 'storefrontSummary', true)
  if (!description.value.trim()) add('content', '请填写商品详情', 'storefrontDescription')
  if (description.value.length > 5000)
    add('content', '商品详情不能超过 5000 个字', 'storefrontDescription', true)
  if (series.value.length > 80) add('content', '系列名称不能超过 80 个字', 'storefrontSeries', true)
  if (keywords.value.length > 300)
    add('content', '内部搜索词不能超过 300 个字', 'storefrontKeywords', true)
  if (tagsValue.value.length > 10 || tagsValue.value.some((tag) => tag.length > 20))
    add('content', '最多设置 10 个标签，每个不超过 20 个字', 'storefrontTags', true)
  const sort = Number(sortOrder.value)
  if (!Number.isInteger(sort) || sort < -10000 || sort > 10000)
    add('content', '推荐顺序必须是 -10000 到 10000 的整数', 'storefrontSortOrder', true)
  if (!coverKey.value) add('content', '请设置一个商品封面', 'section-media')
  else if (/^data:/i.test(coverKey.value))
    add('content', '旧版封面不能用于正式商品，请重新上传', 'section-media')
  for (const message of data.readinessGroups?.content || [])
    if (!/商品标题|商品卖点|商品详情|商品封面|旧版.*封面/.test(message))
      add('content', message, 'section-content')
  for (const message of data.readinessGroups?.asset || []) add('asset', message, 'identity')
  if (!enabledRows.value.length) add('sale', '请至少启用一个可售 SKU', 'section-skus')
  for (const row of enabledRows.value) {
    const candidate = candidateMap.value.get(row.skuId)
    const label = candidate?.skuCode || '所选 SKU'
    if (!candidate?.compatible) add('sale', `${label} 的帧数不兼容`, 'section-skus', true)
    if (!candidate?.isActive) add('sale', `${label} 已停用`, 'section-skus', true)
    if (
      !Number.isFinite(Number(row.finalPrice)) ||
      Number(row.finalPrice) < Number(candidate?.basePrice) ||
      Number(row.finalPrice) > 999999.99
    )
      add('sale', `${label} 的售价必须不低于基础价`, 'section-skus', true)
    if (
      !Number.isInteger(Number(row.leadTimeDays)) ||
      row.leadTimeDays < 1 ||
      row.leadTimeDays > 60
    )
      add('sale', `${label} 的发货天数必须是 1 至 60 天`, 'section-skus', true)
  }
  const seen = new Set<string>()
  return result.filter((issue) => {
    const key = `${issue.group}:${issue.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
})
const issueGroups = computed(() => ({
  content: issues.value.filter((issue) => issue.group === 'content'),
  asset: issues.value.filter((issue) => issue.group === 'asset'),
  sale: issues.value.filter((issue) => issue.group === 'sale')
}))
const previewMedia = computed(
  () =>
    media.value.find((item) => item.key === coverKey.value) ||
    (workspace.value?.coverUrl
      ? { url: workspace.value.coverUrl, kind: 'image' as const }
      : media.value[0])
)
const minimumPrice = computed(() =>
  Math.min(...enabledRows.value.map((row) => Number(row.finalPrice)).filter(Number.isFinite))
)
function flash(message: string): void {
  notice.value = message
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => {
    notice.value = ''
  }, 2800)
}
function date(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString('zh-CN')
}
function shelfText(value?: string | null): string {
  return (
    ({ on_sale: '销售中', suspended: '暂停销售', off_shelf: '已下架' } as Record<string, string>)[
      value || ''
    ] || '未上架'
  )
}
function safeMediaUrl(item: Pick<ProductMedia, 'url'>): string | null {
  return item.url.startsWith('blob:') && ownedObjectUrls.has(item.url)
    ? item.url
    : safeImageUrl(item.url)
}
function revokeUnusedUrls(next: ProductMedia[]): void {
  for (const url of ownedObjectUrls)
    if (!next.some((item) => item.url === url)) {
      URL.revokeObjectURL(url)
      ownedObjectUrls.delete(url)
    }
}
async function load(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    const data = await getProductWorkspace(workId)
    workspace.value = data
    rows.value = (data.selected || [])
      .filter((row) =>
        data.candidates.some((candidate) => candidate.id === row.skuId && candidate.compatible)
      )
      .sort((a, b) => a.sortOrder - b.sortOrder)
    revokeUnusedUrls(data.storefrontMedia || [])
    media.value = (data.storefrontMedia || []).map((item) => ({ ...item }))
    title.value = data.storefrontTitle || ''
    series.value = data.storefrontSeries || ''
    summary.value = data.storefrontSummary || ''
    description.value = data.storefrontDescription || ''
    tags.value = (data.storefrontTags || []).join('，')
    keywords.value = data.storefrontKeywords || ''
    sortOrder.value = String(data.storefrontSortOrder || 0)
    coverKey.value = data.coverKey || ''
    try {
      history.value = await getProductHistory(workId)
      historyError.value = false
    } catch {
      historyError.value = true
    }
  } catch (cause) {
    loadError.value = cause instanceof Error ? cause.message : '加载失败'
  } finally {
    loading.value = false
  }
}
function findRow(id: string): ProductSelection | undefined {
  return rows.value.find((row) => row.skuId === id)
}
function toggleSku(candidate: ProductCandidate, checked: boolean): void {
  if (checked && candidate.compatible && candidate.isActive && !findRow(candidate.id))
    rows.value.push({
      skuId: candidate.id,
      finalPrice: candidate.basePrice,
      fulfillmentMode: 'MAKE_TO_ORDER',
      leadTimeDays: 7,
      sortOrder: rows.value.length,
      isEnabled: true
    })
  if (!checked) rows.value = rows.value.filter((row) => row.skuId !== candidate.id)
}
function moveSku(id: string, direction: number): void {
  const index = rows.value.findIndex((row) => row.skuId === id)
  const next = index + direction
  if (index < 0 || next < 0 || next >= rows.value.length) return
  ;[rows.value[index], rows.value[next]] = [rows.value[next]!, rows.value[index]!]
  rows.value.forEach((row, order) => {
    row.sortOrder = order
  })
}
function moveMedia(index: number, direction: number): void {
  const next = index + direction
  if (next < 0 || next >= media.value.length) return
  ;[media.value[index], media.value[next]] = [media.value[next]!, media.value[index]!]
}
function removeMedia(index: number): void {
  const removed = media.value.splice(index, 1)[0]
  if (removed?.key === coverKey.value) coverKey.value = media.value[0]?.key || ''
  revokeUnusedUrls(media.value)
}
function applyBulk(): void {
  const days = Number(bulkDays.value),
    markup = Number(bulkMarkup.value)
  if (!Number.isInteger(days) || days < 1 || days > 60 || !Number.isFinite(markup) || markup < 0) {
    flash('请填写有效的发货天数和加价金额')
    return
  }
  rows.value.forEach((row) => {
    const candidate = candidateMap.value.get(row.skuId)
    if (!candidate) return
    row.fulfillmentMode = bulkMode.value
    row.leadTimeDays = days
    row.finalPrice = Number((candidate.basePrice + markup).toFixed(2))
  })
  flash('已应用到全部已选规格')
}
async function uploadMedia(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const files = [...(input.files || [])]
  input.value = ''
  if (!files.length) return
  if (media.value.length + files.length > 8) {
    flash('展示素材最多 8 个')
    return
  }
  if (busy.value) return
  busy.value = true
  try {
    for (let index = 0; index < files.length; index++) {
      const file = files[index]!
      flash(`正在上传 ${index + 1}/${files.length}`)
      const key = await uploadStorefrontMedia(file)
      const url = URL.createObjectURL(file)
      ownedObjectUrls.add(url)
      media.value.push({ key, url, kind: file.type.startsWith('video/') ? 'video' : 'image' })
    }
    if ((!coverKey.value || /^data:/i.test(coverKey.value)) && media.value[0])
      coverKey.value = media.value[0].key
    flash('素材上传完成，保存后生效')
  } catch (cause) {
    flash(`上传失败：${cause instanceof Error ? cause.message : '网络错误'}`)
  } finally {
    busy.value = false
  }
}
function focusIssue(issue: Issue): void {
  document.getElementById(issue.target)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}
function reportIssues(action: string, candidates: Issue[]): void {
  if (!candidates.length) return
  flash(`暂不能${action}：${candidates[0]!.message}`)
  focusIssue(candidates[0]!)
}
function payload(): ProductPayload {
  return {
    storefrontTitle: title.value,
    storefrontSummary: summary.value,
    storefrontDescription: description.value,
    storefrontSeries: series.value,
    storefrontTags: tagsValue.value,
    storefrontKeywords: keywords.value,
    storefrontSortOrder: Number(sortOrder.value || 0),
    storefrontMedia: media.value.map((item) => item.key),
    coverKey: /^data:/i.test(coverKey.value) ? '' : coverKey.value,
    skus: rows.value.map((row, index) => ({ ...row, sortOrder: index }))
  }
}
async function persist(showMessage: boolean): Promise<{ ready: boolean } | null> {
  const blocking = issues.value.filter((issue) => issue.blockSave)
  if (blocking.length) {
    reportIssues('保存', blocking)
    return null
  }
  try {
    const result = await saveProductWorkspace(workId, payload())
    await load()
    if (showMessage) flash(result.ready ? '商品资料已保存' : '商品资料已保存，还有上架必填项未完成')
    return result
  } catch (cause) {
    flash(`保存失败：${cause instanceof Error ? cause.message : '网络错误'}`)
    return null
  }
}
async function save(): Promise<void> {
  if (busy.value || !workspace.value) return
  busy.value = true
  try {
    await persist(true)
  } finally {
    busy.value = false
  }
}
async function publish(): Promise<void> {
  if (busy.value || !workspace.value || workspace.value.isOnShelf) return
  if (issues.value.length) {
    reportIssues('上架', issues.value)
    return
  }
  busy.value = true
  try {
    const saved = await persist(false)
    if (!saved) return
    if (!saved.ready) {
      flash('服务端检查发现尚未满足上架条件')
      return
    }
    await publishProductWorkspace(workId)
    flash('商品已上架')
    await load()
  } catch (cause) {
    flash(`上架失败：${cause instanceof Error ? cause.message : '网络错误'}`)
  } finally {
    busy.value = false
  }
}
function openPreview(): void {
  if (issues.value.length) {
    reportIssues('预览', issues.value)
    return
  }
  previewOpen.value = true
}
onMounted(() => {
  if (workId) void load()
  else void router.replace({ name: 'admin-collab-works' })
})
onBeforeUnmount(() => {
  for (const url of ownedObjectUrls) URL.revokeObjectURL(url)
  window.clearTimeout(noticeTimer)
})
</script>

<template>
  <div class="admin-product-page">
    <AdminSidebar v-model:collapsed="collapsed" v-model:mobile-open="mobileOpen" />
    <main class="product-main" :class="{ expanded: collapsed }">
      <header class="product-topbar">
        <div class="product-top-left">
          <button
            class="product-back"
            type="button"
            title="返回联名作品"
            @click="router.push({ name: 'admin-collab-works' })"
          >
            ←
          </button>
          <div class="product-title-wrap">
            <div class="product-title">
              {{ workspace?.storefrontTitle || workspace?.sourceTitle || '联名商品编辑' }}
            </div>
            <div class="product-sub">
              {{ workspace?.productNo || '保存后生成商品编号' }} ·
              {{ shelfText(workspace?.shelfStatus) }}
            </div>
          </div>
        </div>
        <div class="product-actions">
          <button
            class="product-btn"
            type="button"
            :disabled="loading || busy"
            @click="openPreview"
          >
            顾客预览</button
          ><button
            class="product-btn yellow"
            type="button"
            :disabled="loading || busy || workspace?.isOnShelf"
            @click="publish"
          >
            {{ workspace?.isOnShelf ? '已上架' : '上架' }}</button
          ><button
            class="product-btn primary"
            type="button"
            :disabled="loading || busy"
            @click="save"
          >
            保存
          </button>
        </div>
        <button class="product-menu" type="button" aria-label="打开菜单" @click="mobileOpen = true">
          ☰
        </button>
      </header>
      <div class="product-content">
        <div v-if="loading" class="product-loading">读取商品资料中…</div>
        <div v-else-if="loadError" class="product-loading">
          {{ loadError }} <button class="product-btn" type="button" @click="load">重试</button>
        </div>
        <div v-else-if="workspace" class="product-layout">
          <div>
            <section id="section-content" class="product-section">
              <div class="product-section-head">
                <div>
                  <div class="product-section-title">商品资料</div>
                  <div class="product-section-note">顾客会在联名商品详情页看到这些内容</div>
                </div>
              </div>
              <div class="product-section-body">
                <div class="product-source">
                  已线下确认作品：{{
                    workspace.sourceTitle
                  }}。商品展示资料可独立编辑，不会改变动画资产本身。
                </div>
                <div class="product-grid2">
                  <label class="product-field"
                    >商品标题 *<input id="storefrontTitle" v-model="title" maxlength="120" /></label
                  ><label class="product-field"
                    >系列名称<input
                      id="storefrontSeries"
                      v-model="series"
                      maxlength="80"
                      placeholder="如：动物日常"
                  /></label>
                </div>
                <label class="product-field"
                  >列表卖点简介 *<textarea
                    id="storefrontSummary"
                    v-model="summary"
                    maxlength="300"
                    class="product-summary"
                  ></textarea
                  ><span class="product-counter">{{ summary.length }} / 300</span></label
                ><label class="product-field"
                  >商品详情 *<textarea
                    id="storefrontDescription"
                    v-model="description"
                    maxlength="5000"
                    class="product-description"
                    placeholder="说明动画内容、产品特点与适合场景"
                  ></textarea>
                </label>
                <div class="product-grid2">
                  <label class="product-field"
                    >顾客可见标签<input
                      id="storefrontTags"
                      v-model="tags"
                      placeholder="用逗号分隔，最多 10 个" /></label
                  ><label class="product-field"
                    >内部搜索词<input
                      id="storefrontKeywords"
                      v-model="keywords"
                      placeholder="仅后台搜索使用"
                  /></label>
                </div>
                <label class="product-field product-sort"
                  >推荐顺序<input
                    id="storefrontSortOrder"
                    v-model="sortOrder"
                    type="number"
                    min="-10000"
                    max="10000"
                /></label>
              </div>
            </section>
            <section id="section-media" class="product-section">
              <div class="product-section-head">
                <div>
                  <div class="product-section-title">展示素材与封面</div>
                  <div class="product-section-note">
                    最多 8 个图片或视频；至少需要一个可用商品封面
                  </div>
                </div>
              </div>
              <div class="product-section-body">
                <div class="product-media-grid">
                  <div v-for="(item, index) in media" :key="item.key" class="product-media">
                    <div class="product-media-view">
                      <video
                        v-if="item.kind === 'video' && safeMediaUrl(item)"
                        :src="safeMediaUrl(item)!"
                        controls
                        muted
                      ></video
                      ><img
                        v-else-if="safeMediaUrl(item)"
                        :src="safeMediaUrl(item)!"
                        alt="商品展示素材"
                      />
                    </div>
                    <div class="product-media-foot">
                      <button
                        class="product-mini"
                        :class="{ cover: coverKey === item.key }"
                        type="button"
                        @click="coverKey = item.key"
                      >
                        {{ coverKey === item.key ? '当前封面' : '设为封面' }}</button
                      ><button
                        class="product-mini"
                        type="button"
                        :disabled="index === 0"
                        @click="moveMedia(index, -1)"
                      >
                        ←</button
                      ><button
                        class="product-mini"
                        type="button"
                        :disabled="index === media.length - 1"
                        @click="moveMedia(index, 1)"
                      >
                        →</button
                      ><button class="product-mini" type="button" @click="removeMedia(index)">
                        删除
                      </button>
                    </div>
                  </div>
                  <button
                    class="product-upload"
                    type="button"
                    :disabled="busy"
                    @click="uploadInput?.click()"
                  >
                    <span>+</span><strong>上传展示素材</strong
                    ><small>JPG / PNG / WEBP / GIF / MP4</small>
                  </button>
                </div>
                <input
                  ref="uploadInput"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
                  multiple
                  hidden
                  @change="uploadMedia"
                />
              </div>
            </section>
            <section id="section-skus" class="product-section">
              <div class="product-section-head">
                <div>
                  <div class="product-section-title">销售规格</div>
                  <div class="product-section-note">
                    当前动画有
                    {{ workspace.baseFrameCount || 0 }} 个核心帧，只能选择帧数为其整数倍的 SKU。
                  </div>
                </div>
              </div>
              <div class="product-section-body">
                <div class="product-filters">
                  <input v-model="skuSearch" placeholder="搜索 SKU、款式或材质" /><select
                    v-model="sizeFilter"
                  >
                    <option value="">全部尺寸</option>
                    <option v-for="size in sizes" :key="size" :value="size">
                      {{ size }}
                    </option></select
                  ><select v-model="frameFilter">
                    <option value="">全部帧数</option>
                    <option v-for="frame in frames" :key="frame" :value="String(frame)">
                      {{ frame }} 帧
                    </option></select
                  ><label
                    ><input v-model="showIncompatible" type="checkbox" /> 显示不兼容规格</label
                  >
                </div>
                <div class="product-bulk">
                  <b>批量设置已选规格</b
                  ><select v-model="bulkMode">
                    <option value="MAKE_TO_ORDER">允许现做</option>
                    <option value="STOCK_ONLY">仅限现货</option></select
                  ><input
                    v-model="bulkDays"
                    type="number"
                    min="1"
                    max="60"
                    title="发货天数"
                  /><input
                    v-model="bulkMarkup"
                    type="number"
                    min="0"
                    step="0.01"
                    title="在基础价上增加"
                  /><button class="product-mini" type="button" @click="applyBulk">应用</button>
                </div>
                <div class="product-sku-list">
                  <div v-if="!orderedCandidates.length" class="product-empty">
                    没有符合条件的 SKU
                  </div>
                  <div
                    v-for="candidate in orderedCandidates"
                    :key="candidate.id"
                    class="product-sku-row"
                    :class="{ incompatible: !candidate.compatible, off: !candidate.isActive }"
                  >
                    <input
                      type="checkbox"
                      :checked="!!selectedMap.get(candidate.id)"
                      :disabled="!candidate.compatible || !candidate.isActive"
                      title="纳入或移出商品"
                      @change="toggleSku(candidate, ($event.target as HTMLInputElement).checked)"
                    />
                    <div class="product-sku-img">
                      <img
                        v-if="safeImageUrl(candidate.previewImage)"
                        :src="safeImageUrl(candidate.previewImage)!"
                        alt=""
                      /><span v-else>暂无图</span>
                    </div>
                    <div class="product-sku-info">
                      <div class="product-sku-name">
                        {{ candidate.modelName }} · {{ candidate.size }} ·
                        {{ candidate.frameCount }}帧 · {{ candidate.material }} ·
                        {{ candidate.colorName }}
                      </div>
                      <div class="product-sku-meta">
                        {{ candidate.skuCode || candidate.id }} · 基础价 ¥{{
                          Number(candidate.basePrice).toFixed(2)
                        }}{{ candidate.compatible ? '' : ' · 帧数不兼容'
                        }}{{ candidate.isActive ? '' : ' · 已停用' }}
                      </div>
                      <div
                        class="product-stock"
                        :class="candidate.inventory.status === 'ENOUGH' ? 'good' : 'low'"
                      >
                        {{
                          candidate.inventory.status === 'NO_RECORD'
                            ? '未建库存记录'
                            : `可用 ${candidate.inventory.available} · 总数 ${candidate.inventory.current} · 已占用 ${candidate.inventory.reserved}`
                        }}
                      </div>
                    </div>
                    <div class="product-sku-controls">
                      <input
                        :value="selectedMap.get(candidate.id)?.finalPrice ?? candidate.basePrice"
                        type="number"
                        :min="candidate.basePrice"
                        step="0.01"
                        title="最终售价"
                        :disabled="!selectedMap.has(candidate.id)"
                        @change="
                          findRow(candidate.id) &&
                          (findRow(candidate.id)!.finalPrice = Number(
                            ($event.target as HTMLInputElement).value
                          ))
                        "
                      /><select
                        :value="selectedMap.get(candidate.id)?.fulfillmentMode || 'MAKE_TO_ORDER'"
                        title="供货方式"
                        :disabled="!selectedMap.has(candidate.id)"
                        @change="
                          findRow(candidate.id) &&
                          (findRow(candidate.id)!.fulfillmentMode = (
                            $event.target as HTMLSelectElement
                          ).value as FulfillmentMode)
                        "
                      >
                        <option value="MAKE_TO_ORDER">允许现做</option>
                        <option value="STOCK_ONLY">仅限现货</option></select
                      ><input
                        :value="selectedMap.get(candidate.id)?.leadTimeDays ?? 7"
                        type="number"
                        min="1"
                        max="60"
                        title="发货天数"
                        :disabled="!selectedMap.has(candidate.id)"
                        @change="
                          findRow(candidate.id) &&
                          (findRow(candidate.id)!.leadTimeDays = Number(
                            ($event.target as HTMLInputElement).value
                          ))
                        "
                      />
                      <div class="product-order-btns">
                        <button
                          class="product-availability"
                          :class="selectedMap.get(candidate.id)?.isEnabled ? 'on' : 'off'"
                          type="button"
                          :disabled="!selectedMap.has(candidate.id) || !candidate.isActive"
                          @click="
                            findRow(candidate.id) &&
                            (findRow(candidate.id)!.isEnabled = !findRow(candidate.id)!.isEnabled)
                          "
                        >
                          {{ selectedMap.get(candidate.id)?.isEnabled ? '在售' : '停售' }}</button
                        ><button
                          type="button"
                          :disabled="
                            !selectedMap.has(candidate.id) ||
                            rows.findIndex((row) => row.skuId === candidate.id) === 0
                          "
                          @click="moveSku(candidate.id, -1)"
                        >
                          ↑</button
                        ><button
                          type="button"
                          :disabled="
                            !selectedMap.has(candidate.id) ||
                            rows.findIndex((row) => row.skuId === candidate.id) === rows.length - 1
                          "
                          @click="moveSku(candidate.id, 1)"
                        >
                          ↓
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
          <aside class="product-side">
            <section class="product-side-section">
              <div class="product-section-title">上架检查</div>
              <div class="product-status" :class="{ ready: !issues.length }">
                {{ issues.length ? `尚缺 ${issues.length} 项` : '可以上架' }}
              </div>
              <div v-if="!issues.length" class="product-check-ok">
                商品资料、动画资产和销售规格均已通过检查
              </div>
              <div
                v-for="(group, key) in issueGroups"
                v-else
                :key="key"
                class="product-check-group"
              >
                <b>{{
                  key === 'content' ? '商品资料' : key === 'asset' ? '动画资产' : '销售规格'
                }}</b
                ><button
                  v-for="issue in group"
                  :key="issue.message"
                  class="product-check-item"
                  type="button"
                  @click="focusIssue(issue)"
                >
                  {{ issue.message }}
                </button>
                <div v-if="!group.length" class="product-check-ok">已通过</div>
              </div>
            </section>
            <section id="identity" class="product-side-section">
              <div class="product-section-title">商品身份</div>
              <div class="product-source">
                商品编号：<b>{{ workspace.productNo || '保存后生成' }}</b
                ><br />动画资产：<b>{{ workspace.asset?.assetNo || '未关联' }}</b
                ><br />资产版本：<b>{{
                  workspace.asset?.versionNo ? `V${workspace.asset.versionNo}` : '未关联'
                }}</b>
              </div>
            </section>
            <section class="product-side-section">
              <div class="product-section-title">最近修改</div>
              <div v-if="historyError" class="product-sub">记录读取失败</div>
              <div v-else-if="!history.length" class="product-sub">暂无修改记录</div>
              <div v-for="item in history" :key="item.id" class="product-history">
                <b>{{ item.action || '商品资料变更' }}</b>
                <div>{{ item.operatorName }} · {{ date(item.createdAt) }}</div>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </main>
    <div v-if="previewOpen" class="product-preview-overlay" @click.self="previewOpen = false">
      <div class="product-preview">
        <div class="product-preview-head">
          <b>顾客视角预览</b
          ><button class="product-btn" type="button" @click="previewOpen = false">关闭</button>
        </div>
        <div class="product-preview-grid">
          <div class="product-preview-media">
            <video
              v-if="previewMedia?.kind === 'video' && safeMediaUrl(previewMedia)"
              :src="safeMediaUrl(previewMedia)!"
              controls
              muted
            ></video
            ><img
              v-else-if="previewMedia && safeMediaUrl(previewMedia)"
              :src="safeMediaUrl(previewMedia)!"
              alt=""
            />
          </div>
          <div>
            <div class="product-sub">{{ series || '联名作品' }}</div>
            <h1>{{ title }}</h1>
            <p>{{ summary }}</p>
            <div class="product-preview-price">¥{{ minimumPrice.toFixed(2) }} 起</div>
            <div class="product-field">可选规格</div>
            <div class="product-chips">
              <span v-for="row in enabledRows" :key="row.skuId" class="product-chip"
                >{{ candidateMap.get(row.skuId)?.size }} ·
                {{ candidateMap.get(row.skuId)?.frameCount }}帧 ·
                {{ candidateMap.get(row.skuId)?.material }}</span
              >
            </div>
            <div class="product-preview-description">{{ description }}</div>
          </div>
        </div>
      </div>
    </div>
    <div v-if="notice" class="product-toast" role="status">{{ notice }}</div>
  </div>
</template>
