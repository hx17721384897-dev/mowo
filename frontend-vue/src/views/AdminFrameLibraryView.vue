<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import AdminSidebar from '@/components/AdminSidebar.vue'
import { safeImageUrl } from '@/shared/media/safe-image-url'
import {
  archiveFrameAsset,
  createProductionFile,
  deleteFrameAsset,
  deleteProductionFile as removeProductionFile,
  getFrameAsset,
  getFrameVersion,
  getProductionOptions,
  getRenderedFrames,
  listFrameAssets,
  listFrameStats,
  restoreFrameAsset,
  updateFrameAsset,
  type FrameAssetDetail,
  type FrameAssetInput,
  type FrameAssetListItem,
  type FrameCategory,
  type FrameStats,
  type FrameVersion,
  type ProductionFile,
  type ProductionOptions,
  type RenderedFrames
} from '@/features/admin-frame-library/api'
import { useSessionStore } from '@/stores/session'
import './admin-frame-library.css'

const labels = {
  source: {
    WEB_CUSTOM: '网站定制',
    OFFLINE_CUSTOM: '线下定制',
    CREATOR_SUBMISSION: '创作者提供',
    INTERNAL_CREATED: '内部制作'
  },
  usage: {
    PRIVATE_CUSTOM: '私人定制',
    COLLAB_SALE: '联名销售',
    COMPANY_PRODUCT: '公司自营',
    INTERNAL_TEST: '内部测试',
    UNDECIDED: '暂未确定'
  },
  rights: {
    USER: '网站用户',
    OFFLINE_CUSTOMER: '线下客户',
    CREATOR: '创作者',
    COMPANY: '哞屋公司',
    UNCONFIRMED: '暂未确认'
  },
  auth: { PRIVATE_ONLY: '仅限私人使用', PENDING: '授权确认中', AUTHORIZED: '已授权' },
  status: { ACTIVE: '正常', USER_DELETED: '用户已删除', ARCHIVED: '已归档' }
} as const
const categories: Array<[FrameCategory, string]> = [
  ['all', '全部帧图'],
  ['private', '私人定制'],
  ['collab', '联名作品'],
  ['company', '公司自营'],
  ['internal', '内部测试'],
  ['incomplete', '待整理'],
  ['user_deleted', '用户已删除'],
  ['archived', '已归档']
]
const summaryCategories: Array<[FrameCategory, string]> = [
  ['all', '全部资产'],
  ['private', '私人定制'],
  ['collab', '联名作品'],
  ['internal', '内部测试'],
  ['incomplete', '待整理'],
  ['archived', '已归档']
]

const route = useRoute()
const session = useSessionStore()
const collapsed = ref(false)
const mobileOpen = ref(false)
const category = ref<FrameCategory>('all')
const keyword = ref(typeof route.query.keyword === 'string' ? route.query.keyword : '')
const tag = ref('')
const page = ref(1)
const total = ref(0)
const listView = ref(false)
const stats = ref<FrameStats | null>(null)
const assets = ref<FrameAssetListItem[]>([])
const activeId = ref('')
const active = ref<FrameAssetDetail | null>(null)
const version = ref<FrameVersion | null>(null)
const frameIndex = ref(0)
const loading = ref(true)
const detailLoading = ref(false)
const error = ref('')
const notice = ref('')
const busy = ref(false)
const editOpen = ref(false)
const productionOpen = ref(false)
const renderOpen = ref(false)
const productionOptions = ref<ProductionOptions | null>(null)
const rendered = ref<RenderedFrames | null>(null)
const renderLoading = ref(false)
const playing = ref(false)
const productionForm = ref({
  animationVersionId: '',
  targetFrameCount: 0,
  templateVersionId: '',
  markerEnabled: true
})
const form = ref<FrameAssetInput>({
  title: '',
  sourceChannel: 'OFFLINE_CUSTOM',
  usageType: 'PRIVATE_CUSTOM',
  rightsHolderType: 'OFFLINE_CUSTOMER',
  authorizationStatus: 'PRIVATE_ONLY',
  rightsHolderName: '',
  rightsHolderContact: '',
  ownerPhone: '',
  tags: [],
  internalNotes: ''
})
const tagText = ref('')
let loadSequence = 0
let detailSequence = 0
let playTimer: number | undefined
let noticeTimer: number | undefined

const isOwner = computed(() => session.staffRole === 'OWNER')
const canGenerate = computed(() => ['OWNER', 'PRODUCTION'].includes(session.staffRole || ''))
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / 24)))
const currentFrame = computed(() => safeImageUrl(version.value?.frames[frameIndex.value]?.url))
const compatibleTemplates = computed(() => {
  const selected = productionOptions.value?.versions.find(
    (item) => item.id === productionForm.value.animationVersionId
  )
  const baseFrames = selected?.baseFrameCount || 0
  const target = productionForm.value.targetFrameCount
  if (!baseFrames || !target || target % baseFrames !== 0) return []
  return (productionOptions.value?.templates || []).filter(
    (template) => target % template.framesPerSheet === 0
  )
})
const compatibilityHint = computed(() => {
  const selected = productionOptions.value?.versions.find(
    (item) => item.id === productionForm.value.animationVersionId
  )
  const baseFrames = selected?.baseFrameCount || 0
  const target = productionForm.value.targetFrameCount
  if (!target) return '请输入目标商品帧数'
  if (baseFrames && target % baseFrames !== 0) return `目标帧数必须是核心 ${baseFrames} 帧的整数倍`
  return compatibleTemplates.value.length
    ? `找到 ${compatibleTemplates.value.length} 个兼容模板`
    : '没有可整页排版的兼容模板，请先在打印与裁切设置上传模板'
})

function label(group: keyof typeof labels, value: string): string {
  return (labels[group] as Record<string, string>)[value] || value
}
function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '-'
}
function dateOnly(value: string): string {
  return formatDate(value).split(' ')[0] || '-'
}
function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : '网络错误'
}
function flash(value: string): void {
  notice.value = value
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => (notice.value = ''), 2800)
}
function countFor(key: FrameCategory): number {
  if (!stats.value) return 0
  if (key === 'user_deleted') return stats.value.userDeleted
  return stats.value[key]
}
function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  try {
    const url = new URL(value, window.location.origin)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}
function stopPlay(): void {
  window.clearInterval(playTimer)
  playTimer = undefined
  playing.value = false
}
function showFrame(index: number): void {
  frameIndex.value = index
}
function togglePlay(): void {
  if (playTimer) return stopPlay()
  if (!version.value?.frames.length) return
  playing.value = true
  playTimer = window.setInterval(() => {
    frameIndex.value = (frameIndex.value + 1) % (version.value?.frames.length || 1)
  }, 110)
}
function closeDetail(): void {
  stopPlay()
  activeId.value = ''
  active.value = null
  version.value = null
}
function closeOverlays(): void {
  if (busy.value) return
  editOpen.value = false
  productionOpen.value = false
  renderOpen.value = false
  document.body.style.overflow = ''
}

async function loadStats(): Promise<void> {
  stats.value = await listFrameStats()
}
async function loadAssets(): Promise<void> {
  const sequence = ++loadSequence
  loading.value = true
  error.value = ''
  try {
    const data = await listFrameAssets({
      page: page.value,
      category: category.value,
      keyword: keyword.value.trim(),
      tag: tag.value
    })
    if (sequence !== loadSequence) return
    assets.value = data.items
    total.value = data.total
  } catch (cause) {
    if (sequence === loadSequence) error.value = message(cause)
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}
async function loadAll(): Promise<void> {
  try {
    await Promise.all([loadStats(), loadAssets()])
  } catch (cause) {
    flash(message(cause))
  }
}
async function applyFilters(): Promise<void> {
  page.value = 1
  await loadAssets()
}
async function setCategory(next: FrameCategory): Promise<void> {
  category.value = next
  page.value = 1
  await loadAssets()
}
async function selectTag(name: string): Promise<void> {
  tag.value = name
  await applyFilters()
}
async function changePage(delta: number): Promise<void> {
  page.value = Math.min(pageCount.value, Math.max(1, page.value + delta))
  await loadAssets()
}
async function loadVersion(versionNo: number): Promise<void> {
  if (!active.value) return
  stopPlay()
  version.value = null
  frameIndex.value = 0
  try {
    version.value = await getFrameVersion(active.value.id, versionNo)
  } catch (cause) {
    flash(message(cause))
  }
}
async function openDetail(id: string): Promise<void> {
  const sequence = ++detailSequence
  activeId.value = id
  active.value = null
  version.value = null
  detailLoading.value = true
  stopPlay()
  try {
    const detail = await getFrameAsset(id)
    if (sequence !== detailSequence) return
    active.value = detail
    if (detail.currentVersionNo) await loadVersion(detail.currentVersionNo)
  } catch (cause) {
    if (sequence === detailSequence) flash(message(cause))
  } finally {
    if (sequence === detailSequence) detailLoading.value = false
  }
}

function openEdit(): void {
  if (!active.value || !isOwner.value) return
  form.value = {
    title: active.value.title,
    sourceChannel: active.value.sourceChannel,
    usageType: active.value.usageType,
    rightsHolderType: active.value.rightsHolderType,
    authorizationStatus: active.value.authorizationStatus,
    rightsHolderName: active.value.rightsHolderName || '',
    rightsHolderContact: active.value.rightsHolderContact || '',
    ownerPhone: '',
    tags: active.value.tags.map((item) => item.name),
    internalNotes: active.value.internalNotes || ''
  }
  tagText.value = form.value.tags.join('，')
  editOpen.value = true
  document.body.style.overflow = 'hidden'
}
async function saveAsset(): Promise<void> {
  if (busy.value || !active.value) return
  busy.value = true
  try {
    const id = active.value.id
    await updateFrameAsset(id, {
      ...form.value,
      tags: tagText.value
        .split(/[，,]/)
        .map((item) => item.trim())
        .filter(Boolean)
    })
    editOpen.value = false
    document.body.style.overflow = ''
    flash('资料已更新')
    await Promise.all([loadStats(), loadAssets()])
    await openDetail(id)
  } catch (cause) {
    flash(message(cause))
  } finally {
    busy.value = false
  }
}
async function archiveAsset(): Promise<void> {
  if (
    busy.value ||
    !active.value ||
    !confirm(`归档 ${active.value.assetNo}？归档不会删除帧图和历史关系。`)
  )
    return
  busy.value = true
  try {
    await archiveFrameAsset(active.value.id)
    closeDetail()
    flash('已归档')
    await loadAll()
  } catch (cause) {
    flash(message(cause))
  } finally {
    busy.value = false
  }
}
async function restoreAsset(): Promise<void> {
  if (busy.value || !active.value) return
  busy.value = true
  const id = active.value.id
  try {
    await restoreFrameAsset(id)
    flash('已恢复')
    await loadAll()
    await openDetail(id)
  } catch (cause) {
    flash(message(cause))
  } finally {
    busy.value = false
  }
}
async function deleteAsset(): Promise<void> {
  if (
    busy.value ||
    !active.value ||
    !confirm(
      `永久删除 ${active.value.assetNo}？只有完全没有业务关联的内部测试素材才能删除，此操作不能撤销。`
    )
  )
    return
  busy.value = true
  try {
    await deleteFrameAsset(active.value.id)
    closeDetail()
    flash('内部测试素材已永久删除')
    await loadAll()
  } catch (cause) {
    flash(message(cause))
  } finally {
    busy.value = false
  }
}

async function downloadFile(file: ProductionFile): Promise<void> {
  const url = safeHttpUrl(file.downloadUrl)
  if (!url) return flash('下载链接无效，请刷新后重试')
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error('下载链接已失效，请刷新页面后重试')
    const objectUrl = URL.createObjectURL(await response.blob())
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = file.displayName
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  } catch (cause) {
    flash(message(cause))
  }
}
async function openProduction(): Promise<void> {
  if (!active.value || !canGenerate.value) return
  try {
    productionOptions.value = await getProductionOptions(active.value.id)
    const first = productionOptions.value.versions[0]
    productionForm.value = {
      animationVersionId: first?.id || '',
      targetFrameCount: first?.baseFrameCount || 0,
      templateVersionId: '',
      markerEnabled: true
    }
    productionForm.value.templateVersionId = compatibleTemplates.value[0]?.id || ''
    productionOpen.value = true
    document.body.style.overflow = 'hidden'
  } catch (cause) {
    flash(message(cause))
  }
}
function syncTemplate(): void {
  if (
    !compatibleTemplates.value.some((item) => item.id === productionForm.value.templateVersionId)
  ) {
    productionForm.value.templateVersionId = compatibleTemplates.value[0]?.id || ''
  }
}
async function generateFile(): Promise<void> {
  if (busy.value || !active.value) return
  syncTemplate()
  if (!productionForm.value.templateVersionId) return flash('当前没有可用模板')
  busy.value = true
  const id = active.value.id
  try {
    await createProductionFile(id, { ...productionForm.value })
    productionOpen.value = false
    document.body.style.overflow = ''
    flash('生产文件已经生成')
    await loadAssets()
    await openDetail(id)
  } catch (cause) {
    flash(message(cause))
  } finally {
    busy.value = false
  }
}
async function openRendered(file: ProductionFile): Promise<void> {
  if (!active.value) return
  renderOpen.value = true
  renderLoading.value = true
  rendered.value = null
  document.body.style.overflow = 'hidden'
  try {
    rendered.value = await getRenderedFrames(active.value.id, file.id)
  } catch (cause) {
    flash(message(cause))
  } finally {
    renderLoading.value = false
  }
}
async function deleteFile(file: ProductionFile): Promise<void> {
  if (
    busy.value ||
    !active.value ||
    !confirm(
      `删除生产文件“${file.displayName}”？\n\n只删除这个 Word 文件版本，不会删除动画原始帧和可复用加工帧。`
    )
  )
    return
  busy.value = true
  const id = active.value.id
  try {
    await removeProductionFile(id, file.id)
    flash('生产文件已删除')
    await loadAssets()
    await openDetail(id)
  } catch (cause) {
    flash(message(cause))
  } finally {
    busy.value = false
  }
}

onMounted(loadAll)
onBeforeUnmount(() => {
  stopPlay()
  window.clearTimeout(noticeTimer)
  document.body.style.overflow = ''
})
</script>

<template>
  <div class="frame-library-page">
    <AdminSidebar v-model:collapsed="collapsed" v-model:mobile-open="mobileOpen" />
    <main class="frame-main" :class="{ expanded: collapsed }">
      <header class="frame-topbar">
        <div class="frame-top-title">
          <button class="frame-btn menu-btn" @click="mobileOpen = true">☰</button>
          <h1>帧图资产库</h1>
        </div>
        <div class="top-actions">
          <button class="frame-btn" :disabled="loading" @click="loadAll">刷新</button
          ><RouterLink v-if="isOwner" class="frame-btn btn-black" to="/admin/frame-making"
            >制作新帧图</RouterLink
          >
        </div>
      </header>
      <div class="frame-content">
        <section class="summary" aria-label="资产概览">
          <button
            v-for="item in summaryCategories"
            :key="item[0]"
            :class="{ active: category === item[0] }"
            @click="setCategory(item[0])"
          >
            <b>{{ countFor(item[0]) }}</b
            ><span>{{ item[1] }}</span>
          </button>
        </section>
        <section class="workspace">
          <nav class="filter-nav" aria-label="资料分类">
            <div class="filter-title">资料分类</div>
            <button
              v-for="item in categories"
              :key="item[0]"
              class="filter-item"
              :class="{ active: category === item[0] }"
              @click="setCategory(item[0])"
            >
              <span>{{ item[1] }}</span
              ><span class="filter-count">{{ countFor(item[0]) }}</span>
            </button>
            <div class="tag-list">
              <div class="filter-title">常用标签</div>
              <button
                v-for="item in stats?.tags.slice(0, 12) || []"
                :key="item.name"
                class="filter-item"
                @click="selectTag(item.name)"
              >
                <span>{{ item.name }}</span
                ><span class="filter-count">{{ item._count?.assets || 0 }}</span>
              </button>
            </div>
          </nav>
          <div class="gallery">
            <div class="toolbar">
              <input
                v-model="keyword"
                placeholder="搜索 ANM、名称、用户、定制或订单"
                @keydown.enter="applyFilters"
              /><select v-model="tag" @change="applyFilters">
                <option value="">全部标签</option>
                <option v-for="item in stats?.tags || []" :key="item.name" :value="item.name">
                  {{ item.name }} ({{ item._count?.assets || 0 }})
                </option></select
              ><button class="frame-btn" title="切换列表视图" @click="listView = !listView">
                {{ listView ? '▦' : '☰' }}
              </button>
            </div>
            <div class="asset-grid" :class="{ list: listView }">
              <div v-if="loading" class="empty">正在加载...</div>
              <div v-else-if="error" class="empty">{{ error }}</div>
              <div v-else-if="!assets.length" class="empty">当前分类没有帧图资产</div>
              <article
                v-for="item in assets"
                v-else
                :key="item.id"
                class="asset-card"
                :class="{ active: activeId === item.id }"
                @click="openDetail(item.id)"
              >
                <div class="cover">
                  <img
                    v-if="safeImageUrl(item.coverUrl)"
                    :src="safeImageUrl(item.coverUrl) || undefined"
                    loading="lazy"
                    alt=""
                  /><span v-else class="cover-empty">暂无帧图</span>
                </div>
                <div class="card-body">
                  <div class="card-title">{{ item.title }}</div>
                  <div class="card-meta">
                    <span>{{ item.baseFrameCount || 0 }} 帧</span
                    ><span>{{ dateOnly(item.updatedAt) }}</span>
                  </div>
                  <div class="chips">
                    <span class="chip chip-green">{{ label('source', item.sourceChannel) }}</span
                    ><span
                      class="chip"
                      :class="
                        item.authorizationStatus === 'AUTHORIZED' ? 'chip-green' : 'chip-yellow'
                      "
                      >{{ label('usage', item.usageType) }}</span
                    ><span v-if="item.status !== 'ACTIVE'" class="chip chip-red">{{
                      label('status', item.status)
                    }}</span>
                  </div>
                  <div class="production-links">
                    <span v-if="!item.productionFiles.length" class="card-no"
                      >生产文件：尚未生成</span
                    ><button
                      v-for="file in item.productionFiles.slice(0, 3)"
                      v-else
                      :key="file.id"
                      type="button"
                      @click.stop="downloadFile(file)"
                    >
                      {{ file.displayName }}
                    </button>
                  </div>
                </div>
              </article>
            </div>
            <div class="pager">
              <button class="frame-btn" :disabled="page <= 1" @click="changePage(-1)">上一页</button
              ><span>第 {{ page }} / {{ pageCount }} 页 · 共 {{ total }} 套</span
              ><button class="frame-btn" :disabled="page >= pageCount" @click="changePage(1)">
                下一页
              </button>
            </div>
          </div>
          <aside class="detail" :class="{ open: !!activeId }">
            <div v-if="detailLoading" class="empty">正在读取详情...</div>
            <div v-else-if="!active" class="empty">选择一套动画，查看帧图、版本和业务关系</div>
            <template v-else
              ><div class="detail-head">
                <div>
                  <div class="detail-title">{{ active.title }}</div>
                  <div class="detail-no">
                    {{ active.assetNo }} · 当前 V{{ active.currentVersionNo }}
                  </div>
                </div>
                <button class="frame-btn" @click="closeDetail">×</button>
              </div>
              <div class="detail-body">
                <div class="preview">
                  <img v-if="currentFrame" :src="currentFrame" alt="当前帧" /><span
                    v-else
                    class="cover-empty"
                    >{{ version ? '该版本没有可读取的帧图' : '正在加载帧图...' }}</span
                  ><button
                    v-if="version?.frames.length"
                    class="preview-control"
                    @click="togglePlay"
                  >
                    {{ playing ? 'Ⅱ' : '▶' }}
                  </button>
                </div>
                <div class="frames">
                  <button
                    v-for="(frame, index) in version?.frames || []"
                    :key="frame.index"
                    class="frame"
                    :class="{ active: index === frameIndex }"
                    @click="showFrame(index)"
                  >
                    <img
                      v-if="safeImageUrl(frame.url)"
                      :src="safeImageUrl(frame.url) || undefined"
                      loading="lazy"
                      alt=""
                    />
                  </button>
                </div>
                <div class="section">
                  <div class="section-head">
                    <h3>资料信息</h3>
                    <button v-if="isOwner" class="frame-btn" @click="openEdit">编辑</button>
                  </div>
                  <dl class="info">
                    <dt>来源</dt>
                    <dd>{{ label('source', active.sourceChannel) }}</dd>
                    <dt>当前用途</dt>
                    <dd>{{ label('usage', active.usageType) }}</dd>
                    <dt>权利主体</dt>
                    <dd>
                      {{ label('rights', active.rightsHolderType)
                      }}{{ active.rightsHolderName ? ` · ${active.rightsHolderName}` : '' }}
                    </dd>
                    <dt>联系方式</dt>
                    <dd>
                      {{ active.rightsHolderContact || active.rightsHolderContactMasked || '-' }}
                    </dd>
                    <dt>绑定账号</dt>
                    <dd>
                      {{
                        active.owner
                          ? `${active.owner.nickname}${active.owner.phone ? ` · ${active.owner.phone}` : ''}`
                          : '未绑定网站账号'
                      }}
                    </dd>
                    <dt>授权状态</dt>
                    <dd>{{ label('auth', active.authorizationStatus) }}</dd>
                    <dt>资料状态</dt>
                    <dd>{{ label('status', active.status) }}</dd>
                    <dt>标签</dt>
                    <dd>
                      <span v-for="item in active.tags" :key="item.name" class="chip">{{
                        item.name
                      }}</span
                      ><span v-if="!active.tags.length">-</span>
                    </dd>
                    <dt>内部备注</dt>
                    <dd>{{ active.internalNotes || '-' }}</dd>
                    <dt>建立时间</dt>
                    <dd>{{ formatDate(active.createdAt) }}</dd>
                  </dl>
                </div>
                <div class="section">
                  <div class="section-head">
                    <h3>生产文件</h3>
                    <button v-if="canGenerate" class="frame-btn" @click="openProduction">
                      新增文件版本
                    </button>
                  </div>
                  <div v-if="active.productionFiles.length" class="relations">
                    <div v-for="file in active.productionFiles" :key="file.id" class="relation">
                      <div>
                        <button class="download-link" @click="downloadFile(file)">
                          {{ file.displayName }}
                        </button>
                        <div class="field-hint">
                          动画V{{ file.animationVersionNo }} · 模板V{{ file.templateVersionNo }} ·
                          加工帧{{ file.renderedFrameCount }}张 · {{ formatDate(file.createdAt) }}
                        </div>
                      </div>
                      <div class="production-actions">
                        <button class="frame-btn" @click="openRendered(file)">查看加工帧</button
                        ><button
                          v-if="file.canDelete"
                          class="frame-btn btn-danger"
                          @click="deleteFile(file)"
                        >
                          删除</button
                        ><span v-else-if="file.deleteBlockedReason" class="field-hint">{{
                          file.deleteBlockedReason
                        }}</span>
                      </div>
                    </div>
                  </div>
                  <div v-else class="field-hint">生产文件：尚未生成</div>
                </div>
                <div class="section">
                  <h3>不可覆盖版本</h3>
                  <div class="relations">
                    <button
                      v-for="item in active.versions"
                      :key="item.id"
                      class="relation version-row"
                      @click="loadVersion(item.versionNo)"
                    >
                      <strong>V{{ item.versionNo }} · {{ item.baseFrameCount }} 帧</strong
                      ><span>{{ formatDate(item.createdAt) }}</span>
                    </button>
                    <div v-if="!active.versions.length" class="empty">暂无正式版本</div>
                  </div>
                </div>
                <div class="section">
                  <h3>关联记录</h3>
                  <div class="relations">
                    <div class="relation">
                      <strong>定制记录</strong
                      ><span>{{ active._count.customizationRequests }}</span>
                    </div>
                    <div
                      v-for="item in active.customizationRequests"
                      :key="item.id"
                      class="relation"
                    >
                      <span>{{ item.requestNo || '未编号' }}</span
                      ><span>{{ item.status }}</span>
                    </div>
                    <div class="relation">
                      <strong>联名作品</strong><span>{{ active._count.collabWorks }}</span>
                    </div>
                    <div v-for="item in active.collabWorks" :key="item.id" class="relation">
                      <span>{{ item.title }}</span
                      ><span>{{ item.status }}</span>
                    </div>
                    <div class="relation">
                      <strong>订单商品</strong><span>{{ active._count.salesOrderItems }}</span>
                    </div>
                    <div v-for="item in active.salesOrderItems" :key="item.id" class="relation">
                      <span>{{ item.salesOrder.orderNo }} · {{ item.skuCode || '-' }}</span
                      ><span>{{ item.salesOrder.status }}</span>
                    </div>
                  </div>
                </div>
                <div v-if="isOwner" class="detail-actions">
                  <button
                    v-if="active.status === 'ARCHIVED'"
                    class="frame-btn"
                    :disabled="busy"
                    @click="restoreAsset"
                  >
                    恢复资料</button
                  ><button v-else class="frame-btn" :disabled="busy" @click="archiveAsset">
                    归档</button
                  ><button class="frame-btn btn-danger" :disabled="busy" @click="deleteAsset">
                    永久删除
                  </button>
                </div>
              </div></template
            >
          </aside>
        </section>
      </div>
    </main>

    <div v-if="editOpen" class="overlay show" @click.self="closeOverlays">
      <div class="modal">
        <div class="modal-head">
          <div>
            <strong>编辑资产资料</strong>
            <div class="field-hint">{{ active?.assetNo }} · 不会覆盖历史帧图版本</div>
          </div>
          <button class="frame-btn" @click="closeOverlays">关闭</button>
        </div>
        <div class="modal-body">
          <div class="form-grid">
            <div class="field wide">
              <label>动画名称 *</label><input v-model="form.title" maxlength="200" />
            </div>
            <div class="field">
              <label>素材来源 *</label
              ><select v-model="form.sourceChannel">
                <option value="OFFLINE_CUSTOM">线下定制</option>
                <option value="CREATOR_SUBMISSION">创作者提供</option>
                <option value="INTERNAL_CREATED">内部制作</option>
              </select>
            </div>
            <div class="field">
              <label>当前用途 *</label
              ><select v-model="form.usageType">
                <option value="PRIVATE_CUSTOM">私人定制</option>
                <option value="INTERNAL_TEST">内部测试</option>
                <option value="UNDECIDED">暂未确定</option>
                <option value="COLLAB_SALE">联名销售</option>
                <option value="COMPANY_PRODUCT">公司自营</option>
              </select>
            </div>
            <div class="field">
              <label>权利主体 *</label
              ><select v-model="form.rightsHolderType">
                <option value="OFFLINE_CUSTOMER">线下客户</option>
                <option value="CREATOR">创作者</option>
                <option value="COMPANY">哞屋公司</option>
                <option value="USER">网站用户</option>
                <option value="UNCONFIRMED">暂未确认</option>
              </select>
            </div>
            <div class="field">
              <label>授权状态 *</label
              ><select v-model="form.authorizationStatus">
                <option value="PRIVATE_ONLY">仅限私人定制</option>
                <option value="PENDING">授权确认中</option>
                <option value="AUTHORIZED">已确认可合作使用</option>
              </select>
            </div>
            <div class="field">
              <label>客户或权利人名称</label
              ><input v-model="form.rightsHolderName" maxlength="120" />
            </div>
            <div class="field">
              <label>联系方式</label><input v-model="form.rightsHolderContact" maxlength="200" />
              <div class="field-hint">仅负责人可以查看完整联系方式</div>
            </div>
            <div class="field">
              <label>绑定网站账号手机号</label
              ><input
                v-model="form.ownerPhone"
                maxlength="20"
                :placeholder="active?.owner ? '已绑定；留空保持不变' : '输入已注册的手机号完成绑定'"
              />
              <div class="field-hint">线下客户以后注册账号时可以再绑定</div>
            </div>
            <div class="field">
              <label>标签</label
              ><input v-model="tagText" maxlength="300" placeholder="用逗号分隔" />
            </div>
            <div class="field wide">
              <label>内部备注</label
              ><textarea v-model="form.internalNotes" maxlength="4000"></textarea>
            </div>
          </div>
        </div>
        <div class="modal-foot">
          <button class="frame-btn" @click="closeOverlays">取消</button
          ><button class="frame-btn btn-black" :disabled="busy" @click="saveAsset">
            {{ busy ? '正在保存...' : '保存' }}
          </button>
        </div>
      </div>
    </div>
    <div v-if="productionOpen" class="overlay show">
      <div class="modal production-modal">
        <div class="modal-head">
          <div>
            <strong>新增生产文件版本</strong>
            <div class="field-hint">只显示已经上传模板的打印裁切组</div>
          </div>
          <button class="frame-btn" @click="closeOverlays">关闭</button>
        </div>
        <div class="modal-body">
          <div class="form-grid">
            <div class="field">
              <label>动画版本</label
              ><select v-model="productionForm.animationVersionId" @change="syncTemplate">
                <option
                  v-for="item in productionOptions?.versions || []"
                  :key="item.id"
                  :value="item.id"
                >
                  V{{ item.versionNo }} · {{ item.baseFrameCount }}个核心帧
                </option>
              </select>
            </div>
            <div class="field">
              <label>目标商品帧数</label
              ><input
                v-model.number="productionForm.targetFrameCount"
                aria-label="目标商品帧数"
                type="number"
                min="1"
                placeholder="12"
                @input="syncTemplate"
              />
            </div>
            <div class="field wide">
              <label>打印模板</label
              ><select v-model="productionForm.templateVersionId" aria-label="打印模板">
                <option v-for="item in compatibleTemplates" :key="item.id" :value="item.id">
                  {{ item.groupName }} · {{ item.paperSize }} · {{ item.size }} · 单页{{
                    item.framesPerSheet
                  }}帧 · 模板V{{ item.templateVersionNo }}
                </option>
              </select>
              <div class="field-hint">{{ compatibilityHint }}</div>
            </div>
            <div class="field wide">
              <label class="check-label"
                ><input v-model="productionForm.markerEnabled" type="checkbox" />
                添加自适应右下角帧号</label
              >
            </div>
          </div>
        </div>
        <div class="modal-foot">
          <button class="frame-btn" @click="closeOverlays">取消</button
          ><button class="frame-btn btn-black" :disabled="busy" @click="generateFile">
            {{ busy ? '正在生成...' : '生成 Word 文件' }}
          </button>
        </div>
      </div>
    </div>
    <div v-if="renderOpen" class="overlay show" @click.self="closeOverlays">
      <div class="modal render-modal">
        <div class="modal-head">
          <div>
            <strong>{{ rendered?.displayName || '加工帧预览' }}</strong>
            <div class="field-hint">按生产文件使用的加工顺序展示</div>
          </div>
          <button class="frame-btn" @click="closeOverlays">关闭</button>
        </div>
        <div class="modal-body">
          <div v-if="renderLoading" class="render-summary">正在读取...</div>
          <template v-else-if="rendered"
            ><div class="render-summary">
              动画 V{{ rendered.animationVersionNo }} · {{ rendered.size }} ·
              {{ rendered.widthPx }}×{{ rendered.heightPx }}px · 共
              {{ rendered.frames.length }} 张{{
                rendered.markerEnabled ? ' · 已加帧号' : ' · 未加帧号'
              }}
            </div>
            <div class="render-frame-grid">
              <div v-for="item in rendered.frames" :key="item.index" class="render-frame-card">
                <img
                  v-if="safeImageUrl(item.url)"
                  :src="safeImageUrl(item.url) || undefined"
                  loading="lazy"
                  :alt="item.name"
                />
                <div v-else class="render-image-empty">预览失效</div>
                <div class="render-frame-name">
                  <span>第 {{ item.index }} 帧</span><span>{{ item.name }}</span>
                </div>
              </div>
            </div></template
          >
        </div>
      </div>
    </div>
    <div v-if="notice" class="frame-toast">{{ notice }}</div>
  </div>
</template>
