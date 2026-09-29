<script setup lang="ts">
/* eslint-disable vue/html-closing-bracket-newline, vue/html-indent */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AdminSidebar from '@/components/AdminSidebar.vue'
import { runtimeConfig } from '@/config/runtime'
import {
  claimCustomizationRequest,
  claimNextCustomizationRequest,
  customizationStatuses,
  getCustomizationRequest,
  getCustomizationStats,
  listCustomizationRequests,
  safeCustomizationMediaUrl,
  type CustomizationDetail,
  type CustomizationFile,
  type CustomizationFilters,
  type CustomizationListItem,
  type CustomizationStats,
  type CustomizationStatus
} from '@/features/admin-customization-requests/api'
import { useSessionStore } from '@/stores/session'
import './admin-customization-requests.css'

const session = useSessionStore()
const mobileOpen = ref(false)
const collapsed = ref(false)
const stats = ref<CustomizationStats>({ waiting: 0, reviewing: 0, userAction: 0, finished: 0 })
const items = ref<CustomizationListItem[]>([])
const loading = ref(true)
const error = ref('')
const notice = ref('')
const busy = ref(false)
const detail = ref<CustomizationDetail | null>(null)
const detailLoading = ref(false)
const detailError = ref('')
const keyword = ref('')
const filters = ref<CustomizationFilters>({ status: '', mode: '', keyword: '' })

const canEdit = computed(() => ['OWNER', 'PRODUCTION'].includes(session.staffRole ?? ''))
const statusOptions = Object.entries(customizationStatuses) as [CustomizationStatus, string][]
let listSequence = 0
let detailSequence = 0
let noticeTimer: number | undefined
let handoffStarted = false

function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false })
}

function formatSize(value: number): string {
  if (!value) return '—'
  return value > 1_048_576
    ? `${(value / 1_048_576).toFixed(1)} MB`
    : `${(value / 1024).toFixed(1)} KB`
}

function screeningValue(key: string): unknown {
  return detail.value?.screeningData?.[key]
}

function sourceCount(): number {
  const value = Number(screeningValue('sourceCount'))
  return Number.isFinite(value) && value >= 0 ? value : (detail.value?.sourceFiles.length ?? 0)
}

function totalBytes(): number {
  const value = Number(screeningValue('totalBytes'))
  return Number.isFinite(value) && value >= 0 ? value : 0
}

function mediaUrl(file: CustomizationFile): string | null {
  return safeCustomizationMediaUrl(file.url)
}

function flash(message: string): void {
  notice.value = message
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => {
    notice.value = ''
  }, 3000)
}

async function loadStats(): Promise<void> {
  try {
    stats.value = await getCustomizationStats()
  } catch (cause) {
    flash(cause instanceof Error ? cause.message : '统计加载失败')
  }
}

async function loadList(): Promise<void> {
  const sequence = ++listSequence
  loading.value = true
  error.value = ''
  try {
    const result = await listCustomizationRequests(filters.value)
    if (sequence !== listSequence) return
    items.value = result.items
  } catch (cause) {
    if (sequence !== listSequence) return
    error.value = cause instanceof Error ? cause.message : '定制申请加载失败'
  } finally {
    if (sequence === listSequence) loading.value = false
  }
}

async function refresh(): Promise<void> {
  await Promise.all([loadStats(), loadList()])
}

function applySearch(): void {
  filters.value.keyword = keyword.value.trim()
  void loadList()
}

function onFilterChange(): void {
  void loadList()
}

async function openDetail(id: string): Promise<void> {
  const sequence = ++detailSequence
  detail.value = null
  detailError.value = ''
  detailLoading.value = true
  document.body.style.overflow = 'hidden'
  try {
    const result = await getCustomizationRequest(id)
    if (sequence === detailSequence) detail.value = result
  } catch (cause) {
    if (sequence === detailSequence)
      detailError.value = cause instanceof Error ? cause.message : '详情加载失败'
  } finally {
    if (sequence === detailSequence) detailLoading.value = false
  }
}

function closeDetail(): void {
  detailSequence++
  detail.value = null
  detailError.value = ''
  detailLoading.value = false
  document.body.style.overflow = ''
}

function editorUrl(id: string): string {
  return `${runtimeConfig.legacyWebBase}/customize-editor.html?adminRequestId=${encodeURIComponent(id)}&claimed=1`
}

function handoffToEditor(id: string): void {
  window.location.assign(editorUrl(id))
}

async function startFrameTask(id: string): Promise<void> {
  if (!canEdit.value || busy.value || handoffStarted) return
  handoffStarted = true
  busy.value = true
  try {
    await claimCustomizationRequest(id)
    handoffToEditor(id)
  } catch (cause) {
    handoffStarted = false
    flash(cause instanceof Error ? cause.message : '任务领取失败')
    await refresh()
  } finally {
    busy.value = false
  }
}

async function claimNext(): Promise<void> {
  if (!canEdit.value || busy.value || handoffStarted) return
  handoffStarted = true
  busy.value = true
  try {
    const next = await claimNextCustomizationRequest()
    if (!next) {
      handoffStarted = false
      flash('当前没有等待处理的人工筛选任务')
      await refresh()
      return
    }
    handoffToEditor(next.id)
  } catch (cause) {
    handoffStarted = false
    flash(cause instanceof Error ? cause.message : '领取下一条任务失败')
    await refresh()
  } finally {
    busy.value = false
  }
}

function canStart(item: CustomizationListItem): boolean {
  return (
    canEdit.value &&
    item.canEdit &&
    item.mode === 'HUMAN' &&
    ['SUBMITTED', 'REVIEWING'].includes(item.status)
  )
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeDetail()
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  void refresh()
})

onBeforeUnmount(() => {
  listSequence++
  detailSequence++
  window.clearTimeout(noticeTimer)
  document.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <div class="admin-customization-page">
    <AdminSidebar v-model:mobile-open="mobileOpen" v-model:collapsed="collapsed" />
    <main class="main" :class="{ expanded: collapsed }">
      <header class="topbar">
        <div class="topbar-heading">
          <button
            class="menu-btn"
            type="button"
            aria-label="打开后台菜单"
            @click="mobileOpen = true"
          >
            ☰
          </button>
          <span class="topbar-title">定制处理</span>
        </div>
        <span class="topbar-note">处理人工筛帧任务并查看定制记录</span>
      </header>

      <div class="content">
        <section class="metrics" aria-label="定制处理统计">
          <div class="metric">
            <strong>{{ stats.waiting }}</strong
            ><span>等待处理</span>
          </div>
          <div class="metric">
            <strong>{{ stats.reviewing }}</strong
            ><span>正在处理</span>
          </div>
          <div class="metric">
            <strong>{{ stats.userAction }}</strong
            ><span>等待用户</span>
          </div>
          <div class="metric">
            <strong>{{ stats.finished }}</strong
            ><span>已结束</span>
          </div>
        </section>

        <form class="toolbar" @submit.prevent="applySearch">
          <select
            v-model="filters.status"
            class="select"
            aria-label="按状态筛选"
            @change="onFilterChange"
          >
            <option value="">全部状态</option>
            <option v-for="[status, label] in statusOptions" :key="status" :value="status">
              {{ label }}
            </option>
          </select>
          <select
            v-model="filters.mode"
            class="select"
            aria-label="按处理方式筛选"
            @change="onFilterChange"
          >
            <option value="">全部方式</option>
            <option value="SELF">自己筛选</option>
            <option value="HUMAN">人工筛选</option>
          </select>
          <input
            v-model="keyword"
            class="input"
            aria-label="搜索定制申请"
            placeholder="定制编号或用户昵称"
          />
          <button class="btn dark" type="submit">查询</button>
          <button class="btn" type="button" @click="refresh">↻ 刷新</button>
          <button v-if="canEdit" class="btn dark" type="button" :disabled="busy" @click="claimNext">
            领取下一条人工筛帧
          </button>
        </form>

        <div class="table">
          <div class="row head" aria-hidden="true">
            <div>定制编号 / 用户</div>
            <div>处理方式</div>
            <div>状态</div>
            <div>期望款式</div>
            <div>提交时间</div>
            <div>操作</div>
          </div>
          <div v-if="loading" class="empty">正在加载</div>
          <div v-else-if="error" class="empty error-state">{{ error }}</div>
          <div v-else-if="!items.length" class="empty">没有符合条件的定制申请</div>
          <div v-for="item in items" v-else :key="item.id" class="row request-row">
            <div>
              <div class="number">{{ item.requestNo }}</div>
              <div class="sub">
                {{ item.user.nickname }} · 手机尾号 {{ item.user.phoneTail || '—' }}
              </div>
              <div v-if="item.assignedStaffName" class="assignee">
                处理人：{{ item.assignedStaffName }}
              </div>
            </div>
            <div>
              <span class="badge" :class="`mode-${item.mode.toLowerCase()}`">{{
                item.mode === 'HUMAN' ? '人工筛选' : '自己筛选'
              }}</span>
            </div>
            <div>
              <span class="badge" :class="`s-${item.status}`">{{
                customizationStatuses[item.status]
              }}</span>
            </div>
            <div>
              <div class="number">{{ item.modelName }}</div>
              <div class="sub">第 {{ item.version }} 版</div>
            </div>
            <div class="sub">{{ formatDate(item.submittedAt) }}</div>
            <div class="actions">
              <button class="view" type="button" @click="openDetail(item.id)">查看</button>
              <button
                v-if="canStart(item)"
                class="view primary"
                type="button"
                :disabled="busy"
                @click="startFrameTask(item.id)"
              >
                {{ item.status === 'REVIEWING' ? '继续筛帧' : '开始筛帧' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>

    <div
      v-if="detailLoading || detail || detailError"
      class="modal-bg open"
      @click.self="closeDetail"
    >
      <section class="modal" role="dialog" aria-modal="true" aria-label="定制申请详情">
        <div class="modal-head">
          <div>
            <div class="label">定制申请</div>
            <h2 class="modal-title">{{ detail?.requestNo || '正在加载' }}</h2>
          </div>
          <button class="close" type="button" aria-label="关闭详情" @click="closeDetail">×</button>
        </div>
        <div v-if="detailLoading" class="empty">正在读取私有素材</div>
        <div v-else-if="detailError" class="empty error-state">{{ detailError }}</div>
        <div v-else-if="detail" class="modal-body">
          <div class="detail-grid">
            <div>
              <div class="label">用户</div>
              <div class="value">
                {{ detail.user.nickname }} · 尾号 {{ detail.user.phoneTail || '—' }}
              </div>
            </div>
            <div>
              <div class="label">处理方式</div>
              <div class="value">
                {{ detail.mode === 'HUMAN' ? '人工帮忙筛选' : '用户自己筛选' }}
              </div>
            </div>
            <div>
              <div class="label">期望款式</div>
              <div class="value">{{ detail.model?.name || detail.modelName || '—' }}</div>
            </div>
            <div>
              <div class="label">当前状态</div>
              <div class="value">{{ customizationStatuses[detail.status] }}</div>
            </div>
            <div>
              <div class="label">素材数量</div>
              <div class="value">{{ sourceCount() }}</div>
            </div>
            <div>
              <div class="label">素材大小</div>
              <div class="value">{{ formatSize(totalBytes()) }}</div>
            </div>
            <div>
              <div class="label">比例检查</div>
              <div class="value">
                {{ screeningValue('ratioOk') === false ? '需人工确认' : '未发现明显问题' }}
              </div>
            </div>
            <div>
              <div class="label">创作者声明</div>
              <div class="value">{{ detail.creatorDeclared ? '是' : '否' }}</div>
            </div>
          </div>

          <h3 class="section-title">用户说明</h3>
          <div class="note-box">{{ detail.userNote || '未填写' }}</div>

          <h3 class="section-title">原始素材</h3>
          <div class="files">
            <template v-for="file in detail.sourceFiles" :key="file.key">
              <div class="file">
                <video
                  v-if="file.mimeType.startsWith('video/') && mediaUrl(file)"
                  class="file-media"
                  controls
                  preload="metadata"
                  :src="mediaUrl(file) || undefined"
                ></video>
                <img
                  v-else-if="mediaUrl(file)"
                  class="file-media"
                  :src="mediaUrl(file) || undefined"
                  :alt="file.filename"
                />
                <div v-else class="file-media invalid-media">素材地址不可用</div>
                <div class="file-name">{{ file.filename }}</div>
                <div class="sub">{{ formatSize(file.sizeBytes) }}</div>
                <a
                  v-if="mediaUrl(file)"
                  :href="mediaUrl(file) || undefined"
                  target="_blank"
                  rel="noopener noreferrer"
                  >单独打开</a
                >
              </div>
            </template>
            <div v-if="!detail.sourceFiles.length" class="sub">没有可读取的原素材</div>
          </div>

          <template v-if="detail.selectedFrames.length">
            <h3 class="section-title">用户选中帧</h3>
            <div class="files">
              <div v-for="file in detail.selectedFrames" :key="file.key" class="file">
                <img
                  v-if="mediaUrl(file)"
                  class="file-media"
                  :src="mediaUrl(file) || undefined"
                  :alt="file.filename"
                />
                <div v-else class="file-media invalid-media">素材地址不可用</div>
                <div class="file-name">{{ file.filename }}</div>
                <div class="sub">{{ formatSize(file.sizeBytes) }}</div>
                <a
                  v-if="mediaUrl(file)"
                  :href="mediaUrl(file) || undefined"
                  target="_blank"
                  rel="noopener noreferrer"
                  >单独打开</a
                >
              </div>
            </div>
          </template>

          <h3 class="section-title">处理时间线</h3>
          <div class="timeline">
            <div
              v-for="event in detail.events"
              :key="event.id || `${event.eventType}-${event.createdAt}`"
              class="event"
            >
              <strong>{{
                (event.toStatus && customizationStatuses[event.toStatus as CustomizationStatus]) ||
                event.eventType
              }}</strong>
              <p>{{ event.publicMessage || '记录已更新' }} · {{ formatDate(event.createdAt) }}</p>
            </div>
            <div v-if="!detail.events.length" class="sub">暂无处理记录</div>
          </div>
        </div>
      </section>
    </div>

    <div v-if="notice" class="toast" role="status">{{ notice }}</div>
  </div>
</template>
