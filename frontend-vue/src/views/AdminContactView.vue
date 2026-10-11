<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AdminSidebar from '@/components/AdminSidebar.vue'
import {
  contactStatuses,
  contactTypes,
  getContact,
  getContactStats,
  listContacts,
  messageLabels,
  safeExternalLink,
  saveContactNote,
  setContactStar,
  setContactStatus,
  type ContactFilters,
  type ContactItem,
  type ContactStats,
  type ContactStatus,
  type ContactType
} from '@/features/admin-contact/api'
import './admin-contact.css'

const mobileOpen = ref(false)
const collapsed = ref(false)
const time = ref('')
const stats = ref<ContactStats | null>(null)
const list = ref<ContactItem[]>([])
const total = ref(0)
const loading = ref(true)
const error = ref('')
const notice = ref('')
const detail = ref<ContactItem | null>(null)
const detailLoading = ref(false)
const detailError = ref('')
const note = ref('')
const busy = ref(false)
const searchText = ref('')
const filters = ref<ContactFilters>({ page: 1, status: '', starred: false, type: '', keyword: '' })
const statusEntries = Object.entries(contactStatuses) as [ContactStatus, string][]
const typeEntries = Object.entries(contactTypes) as [ContactType, string][]
const typeIcons: Record<ContactType, string> = {
  artist: '🎨',
  channel: '🏪',
  media: '📣',
  join: '💼',
  feedback: '💡',
  factory: '🏭'
}
const statusColors: Record<ContactStatus, string> = {
  pending: 'orange',
  processing: 'blue',
  done: 'green',
  spam: 'red'
}
const pageCount = computed(() => Math.ceil(total.value / 20))
const pageNumbers = computed(() =>
  Array.from(
    { length: Math.min(5, pageCount.value) },
    (_, index) => Math.max(1, Math.min(filters.value.page - 2, pageCount.value - 4)) + index
  )
)
const activeTags = computed(() => [
  ...(filters.value.status
    ? [{ key: 'status', label: contactStatuses[filters.value.status] }]
    : []),
  ...(filters.value.starred ? [{ key: 'starred', label: '⭐ 星标' }] : []),
  ...(filters.value.type ? [{ key: 'type', label: contactTypes[filters.value.type] }] : []),
  ...(filters.value.keyword ? [{ key: 'keyword', label: `"${filters.value.keyword}"` }] : [])
])

let clock: number | undefined
let listSequence = 0
let detailSequence = 0
let noticeTimer: number | undefined

function formatDate(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })
}

function flash(message: string): void {
  notice.value = message
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => {
    notice.value = ''
  }, 2500)
}

async function loadStats(): Promise<void> {
  try {
    stats.value = await getContactStats()
  } catch (cause) {
    flash(cause instanceof Error ? cause.message : '统计加载失败')
  }
}

async function loadList(page = filters.value.page): Promise<void> {
  const sequence = ++listSequence
  filters.value.page = page
  loading.value = true
  error.value = ''
  try {
    const response = await listContacts({ ...filters.value })
    if (sequence !== listSequence) return
    list.value = response.items
    total.value = response.pagination.total
  } catch (cause) {
    if (sequence !== listSequence) return
    error.value = cause instanceof Error ? cause.message : '联络留言加载失败'
  } finally {
    if (sequence === listSequence) loading.value = false
  }
}

function toggleStatus(value: ContactStatus): void {
  filters.value.status = filters.value.status === value ? '' : value
  void loadList(1)
}
function toggleType(value: ContactType): void {
  filters.value.type = filters.value.type === value ? '' : value
  void loadList(1)
}
function toggleStarred(): void {
  filters.value.starred = !filters.value.starred
  void loadList(1)
}
function clearTag(key: string): void {
  if (key === 'status') filters.value.status = ''
  if (key === 'type') filters.value.type = ''
  if (key === 'starred') filters.value.starred = false
  if (key === 'keyword') {
    filters.value.keyword = ''
    searchText.value = ''
  }
  void loadList(1)
}
function applySearch(): void {
  filters.value.keyword = searchText.value.trim()
  void loadList(1)
}
function resetAll(): void {
  searchText.value = ''
  filters.value = { page: 1, status: '', starred: false, type: '', keyword: '' }
  void loadList(1)
}
async function refresh(): Promise<void> {
  await Promise.all([loadStats(), loadList(1)])
}

async function openDetail(id: string): Promise<void> {
  const sequence = ++detailSequence
  detail.value = null
  detailLoading.value = true
  detailError.value = ''
  try {
    const item = await getContact(id)
    if (sequence !== detailSequence) return
    detail.value = item
    note.value = detail.value.note ?? ''
    document.body.style.overflow = 'hidden'
  } catch (cause) {
    if (sequence !== detailSequence) return
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
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeDetail()
}

async function changeStatus(id: string, status: ContactStatus): Promise<void> {
  if (busy.value) return
  busy.value = true
  let saved = false
  try {
    await setContactStatus(id, status)
    saved = true
    await Promise.all([loadStats(), loadList()])
    if (detail.value?.id === id) detail.value = await getContact(id)
    flash(`✅ 已改为「${contactStatuses[status]}」`)
  } catch (cause) {
    flash(
      saved
        ? '状态已保存，但刷新失败，请重试刷新'
        : `失败：${cause instanceof Error ? cause.message : '状态未保存'}`
    )
    await loadList()
    if (detail.value?.id === id) detail.value = await getContact(id).catch(() => detail.value)
  } finally {
    busy.value = false
  }
}
function rowStatus(event: Event, id: string): void {
  const status = (event.target as HTMLSelectElement).value as ContactStatus
  void changeStatus(id, status)
}
async function toggleItemStar(item: ContactItem): Promise<void> {
  if (busy.value) return
  busy.value = true
  let saved = false
  try {
    await setContactStar(item.id, !item.isStarred)
    saved = true
    await Promise.all([loadStats(), loadList()])
    if (detail.value?.id === item.id) detail.value = await getContact(item.id)
    flash(item.isStarred ? '已取消星标' : '⭐ 已加星标')
  } catch (cause) {
    flash(
      saved
        ? '星标已保存，但刷新失败，请重试刷新'
        : `失败：${cause instanceof Error ? cause.message : '星标未保存'}`
    )
    await loadList()
    if (detail.value?.id === item.id)
      detail.value = await getContact(item.id).catch(() => detail.value)
  } finally {
    busy.value = false
  }
}
async function saveNote(): Promise<void> {
  if (!detail.value || busy.value) return
  busy.value = true
  let saved = false
  try {
    await saveContactNote(detail.value.id, note.value)
    saved = true
    detail.value = await getContact(detail.value.id)
    flash('💾 备注已保存')
  } catch (cause) {
    flash(
      saved
        ? '备注已保存，但刷新失败，请重新打开详情'
        : `失败：${cause instanceof Error ? cause.message : '备注未保存'}`
    )
  } finally {
    busy.value = false
  }
}

function extraValue(key: string): string {
  const value = detail.value?.extra?.[key]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}
const extraFields = computed<[string, string][]>(() => {
  const type = detail.value?.type
  if (type === 'artist')
    return [
      ['创作平台', 'platform'],
      ['粉丝量级', 'fanbase'],
      ['作品集链接', 'portfolioUrl']
    ]
  if (type === 'channel')
    return [
      ['公司/门店', 'company'],
      ['所在城市', 'city'],
      ['门店类型', 'storeType']
    ]
  if (type === 'media')
    return [
      ['主要平台', 'platform'],
      ['粉丝/阅读量', 'fanbase'],
      ['主页链接', 'profileUrl']
    ]
  if (type === 'join')
    return [
      ['应聘方向', 'direction'],
      ['工作年限', 'experience'],
      ['个人链接', 'portfolioUrl']
    ]
  if (type === 'feedback')
    return [
      ['反馈类型', 'feedbackType'],
      ['愿意参与内测', 'wantBeta']
    ]
  if (type === 'factory')
    return [
      ['公司/工厂', 'company'],
      ['所在城市', 'city'],
      ['主要生产品类', 'category'],
      ['年产能规模', 'capacity'],
      ['已合作品牌', 'brands'],
      ['官网/资质链接', 'certUrl']
    ]
  return []
})
const extraRows = computed(() =>
  detail.value?.type === 'factory'
    ? [extraFields.value.slice(0, 2), extraFields.value.slice(2, 4)]
    : [extraFields.value.slice(0, 2)]
)
const extraSingles = computed(() =>
  extraFields.value.slice(detail.value?.type === 'factory' ? 4 : 2)
)
function displayExtra(key: string): string {
  if (key === 'wantBeta') return detail.value?.extra?.wantBeta ? '是 ✓' : '否'
  return extraValue(key)
}
function extraLink(key: string): string | null {
  return ['portfolioUrl', 'profileUrl', 'certUrl'].includes(key)
    ? safeExternalLink(extraValue(key))
    : null
}
function attachmentLink(url: string): string | null {
  return safeExternalLink(url)
}
function userLink(id: string) {
  return { name: 'admin-users', query: { highlight: id } }
}

onMounted(() => {
  const updateClock = () => {
    time.value = new Date().toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }
  updateClock()
  clock = window.setInterval(updateClock, 1000)
  document.addEventListener('keydown', onKeydown)
  void refresh()
})
onBeforeUnmount(() => {
  window.clearInterval(clock)
  window.clearTimeout(noticeTimer)
  document.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <div class="admin-contact-page">
    <AdminSidebar v-model:mobile-open="mobileOpen" v-model:collapsed="collapsed" />
    <div class="main" :class="{ expanded: collapsed }">
      <header class="topbar">
        <button class="menu-btn" type="button" aria-label="打开后台菜单" @click="mobileOpen = true">
          ☰
        </button>
        <span class="topbar-title">💌 联络留言</span>
        <div class="topbar-right">
          <span class="topbar-time">{{ time }}</span
          ><button class="btn btn-ghost btn-sm" type="button" @click="refresh">↻ 刷新</button>
        </div>
      </header>
      <div class="content">
        <div class="filter-section">
          <div class="row-label">按状态筛选</div>
          <div class="status-cards">
            <button
              v-for="[status, label] in statusEntries"
              :key="status"
              class="fc"
              :class="[`st-${status}`, { active: filters.status === status }]"
              type="button"
              :aria-pressed="filters.status === status"
              @click="toggleStatus(status)"
            >
              <span class="fc-label">{{ label }}</span
              ><span class="fc-num" :class="`c-${statusColors[status]}`">{{
                stats?.byStatus[status] ?? '–'
              }}</span>
            </button>
            <button
              class="fc st-starred"
              :class="{ active: filters.starred }"
              type="button"
              :aria-pressed="filters.starred"
              @click="toggleStarred"
            >
              <span class="fc-label">⭐ 星标</span
              ><span class="fc-num c-gold">{{ stats?.starredTotal ?? '–' }}</span>
            </button>
          </div>
          <div class="row-label">按分类筛选</div>
          <div class="type-scroll">
            <div class="type-row">
              <button
                v-for="[type, label] in typeEntries"
                :key="type"
                class="fc tp-card"
                :class="{ active: filters.type === type }"
                type="button"
                :aria-pressed="filters.type === type"
                @click="toggleType(type)"
              >
                <span class="fc-label">{{ typeIcons[type] }} {{ label }}</span
                ><span class="fc-num">{{ stats?.byType[type] ?? '–' }}</span>
              </button>
            </div>
          </div>
        </div>
        <form class="search-bar" @submit.prevent="applySearch">
          <input
            v-model="searchText"
            class="search-input"
            placeholder="搜索姓名 / 联系方式 / 内容…"
            type="search"
            aria-label="搜索留言"
          /><button class="sbtn sbtn-primary" type="submit">搜索</button
          ><button class="sbtn sbtn-ghost" type="button" @click="resetAll">重置</button>
        </form>
        <div class="filter-tags">
          <span v-for="tag in activeTags" :key="tag.key" class="ftag"
            >{{ tag.label
            }}<button
              class="ftag-x"
              type="button"
              :aria-label="`清除${tag.label}`"
              @click="clearTag(tag.key)"
            >
              ✕
            </button></span
          >
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>来源</th>
                <th>姓名 / 联系</th>
                <th>内容摘要</th>
                <th>状态</th>
                <th>时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="loading">
                <td colspan="6" class="table-state">加载中…</td>
              </tr>
              <tr v-else-if="error">
                <td colspan="6" class="table-state">
                  <p>{{ error }}</p>
                  <button class="btn btn-ghost btn-sm" type="button" @click="loadList()">
                    重试
                  </button>
                </td>
              </tr>
              <tr v-else-if="!list.length">
                <td colspan="6">
                  <div class="empty-wrap">
                    <div class="empty-icon">📭</div>
                    <div class="empty-text">暂无留言</div>
                  </div>
                </td>
              </tr>
              <tr v-for="item in loading || error ? [] : list" :key="item.id">
                <td>
                  <span class="type-badge" :class="`type-${item.type}`">{{
                    contactTypes[item.type]
                  }}</span>
                </td>
                <td>
                  <div class="td-name">{{ item.name }}</div>
                  <div class="td-sub">{{ item.contact }}</div>
                </td>
                <td>
                  <div class="td-preview">{{ item.message }}</div>
                </td>
                <td>
                  <select
                    class="row-status-sel"
                    :value="item.status"
                    :disabled="busy"
                    :aria-label="`${item.name} 状态`"
                    @change="rowStatus($event, item.id)"
                  >
                    <option v-for="[status, label] in statusEntries" :key="status" :value="status">
                      {{ label }}
                    </option>
                  </select>
                </td>
                <td class="td-time">{{ formatDate(item.createdAt) }}</td>
                <td>
                  <div class="actions-cell">
                    <button class="act-btn" type="button" @click="openDetail(item.id)">查看</button
                    ><button
                      class="star-btn"
                      :class="{ on: item.isStarred }"
                      type="button"
                      :disabled="busy"
                      :aria-label="item.isStarred ? '取消星标' : '加星标'"
                      @click="toggleItemStar(item)"
                    >
                      {{ item.isStarred ? '⭐' : '☆' }}
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <div class="pagination">
            <template v-if="!loading && !error && pageCount > 1">
              <button
                v-if="filters.page > 1"
                class="pg-btn"
                type="button"
                @click="loadList(filters.page - 1)"
              >
                ‹</button
              ><button
                v-for="page in pageNumbers"
                :key="page"
                class="pg-btn"
                :class="{ active: filters.page === page }"
                type="button"
                @click="loadList(page)"
              >
                {{ page }}</button
              ><button
                v-if="filters.page < pageCount"
                class="pg-btn"
                type="button"
                @click="loadList(filters.page + 1)"
              >
                ›</button
              ><span class="pg-info">共 {{ total }} 条</span>
            </template>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="detail || detailLoading || detailError"
      class="modal-bg open"
      role="presentation"
      @click.self="closeDetail"
    >
      <div class="modal-box" role="dialog" aria-modal="true" aria-label="联络留言详情">
        <div class="modal-hd">
          <div class="modal-hd-left">
            <div class="modal-name">{{ detail?.name || '留言详情' }}</div>
            <div v-if="detail" class="modal-meta">
              <span class="type-badge" :class="`type-${detail.type}`">{{
                contactTypes[detail.type]
              }}</span
              ><span class="sbadge" :class="`sb-${detail.status}`"
                ><span class="sdot"></span>{{ contactStatuses[detail.status] }}</span
              ><span class="modal-date">{{ formatDate(detail.createdAt) }}</span>
            </div>
          </div>
          <button class="modal-x" type="button" aria-label="关闭详情" @click="closeDetail">
            ✕
          </button>
        </div>
        <div v-if="detailLoading || detailError" class="modal-bd">
          {{ detailError || '加载中…' }}
        </div>
        <template v-if="detail">
          <div class="modal-ctrl">
            <span class="ctrl-label">状态</span
            ><select
              class="ctrl-status"
              :value="detail.status"
              :disabled="busy"
              aria-label="留言状态"
              @change="rowStatus($event, detail.id)"
            >
              <option v-for="[status, label] in statusEntries" :key="status" :value="status">
                {{ label }}
              </option></select
            ><button
              class="ctrl-star"
              :class="{ on: detail.isStarred }"
              type="button"
              :disabled="busy"
              @click="toggleItemStar(detail)"
            >
              {{ detail.isStarred ? '⭐ 已加星标' : '☆ 加星标' }}</button
            ><button class="ctrl-save" type="button" :disabled="busy" @click="saveNote">
              💾 保存备注
            </button>
          </div>
          <div class="modal-bd">
            <section class="sec">
              <h2 class="sec-title">联系信息</h2>
              <div class="drow">
                <div class="dfield">
                  <div class="dlabel">姓名</div>
                  <div class="dvalue">{{ detail.name }}</div>
                </div>
                <div class="dfield">
                  <div class="dlabel">联系方式</div>
                  <div class="dvalue">{{ detail.contact }}</div>
                </div>
              </div>
            </section>
            <section v-if="extraFields.some((field) => displayExtra(field[1]))" class="sec">
              <h2 class="sec-title">补充信息</h2>
              <div v-for="(row, index) in extraRows" :key="index" class="drow">
                <div
                  v-for="field in row.filter((entry) => displayExtra(entry[1]))"
                  :key="field[1]"
                  class="dfield"
                >
                  <div class="dlabel">{{ field[0] }}</div>
                  <div class="dvalue">{{ displayExtra(field[1]) }}</div>
                </div>
              </div>
              <div
                v-for="field in extraSingles.filter((entry) => displayExtra(entry[1]))"
                :key="field[1]"
                class="dfield"
              >
                <div class="dlabel">{{ field[0] }}</div>
                <div class="dvalue">
                  <a
                    v-if="extraLink(field[1])"
                    :href="extraLink(field[1])!"
                    target="_blank"
                    rel="noopener noreferrer"
                    >{{ displayExtra(field[1]) }}</a
                  ><template v-else>{{ displayExtra(field[1]) }}</template>
                </div>
              </div>
            </section>
            <section class="sec">
              <h2 class="sec-title">{{ messageLabels[detail.type] }}</h2>
              <div class="msg-box">{{ detail.message }}</div>
            </section>
            <section v-if="detail.attachmentUrls.length" class="sec">
              <h2 class="sec-title">附件（{{ detail.attachmentUrls.length }}个）</h2>
              <div class="att-list">
                <div v-for="file in detail.attachmentUrls" :key="file.url" class="att-item">
                  <span>{{ /\.pdf$/i.test(file.filename) ? '📄' : '🖼️' }}</span
                  ><a
                    v-if="attachmentLink(file.url)"
                    :href="attachmentLink(file.url)!"
                    target="_blank"
                    rel="noopener noreferrer"
                    >{{ file.filename }}</a
                  ><span v-else>{{ file.filename }}</span
                  ><a
                    v-if="attachmentLink(file.url)"
                    class="download"
                    :href="attachmentLink(file.url)!"
                    target="_blank"
                    rel="noopener noreferrer"
                    download
                    >下载</a
                  >
                </div>
              </div>
            </section>
            <section class="sec">
              <h2 class="sec-title">内部备注</h2>
              <textarea v-model="note" class="note-ta" placeholder="添加处理备注…"></textarea>
            </section>
            <section class="sec">
              <h2 class="sec-title">系统信息</h2>
              <div class="dfield">
                <div class="dlabel">提交账号</div>
                <div class="dvalue">
                  <RouterLink
                    v-if="detail.submitterUserId"
                    :to="userLink(detail.submitterUserId)"
                    target="_blank"
                    rel="noopener noreferrer"
                    >查看用户主页 →</RouterLink
                  ><span v-else>未登录提交</span>
                </div>
              </div>
              <div v-if="detail.ip" class="dfield">
                <div class="dlabel">提交IP</div>
                <div class="dvalue mono">
                  {{ detail.ip }}{{ detail.isBlocked ? ' 🚫 已封禁' : '' }}
                </div>
              </div>
              <div v-if="detail.handledAt" class="dfield">
                <div class="dlabel">最后处理</div>
                <div class="dvalue">{{ formatDate(detail.handledAt) }}</div>
              </div>
            </section>
          </div>
        </template>
      </div>
    </div>
    <div v-if="notice" class="toast show" role="status">{{ notice }}</div>
  </div>
</template>
