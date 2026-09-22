<script setup lang="ts">
/* eslint-disable vue/html-closing-bracket-newline, vue/html-indent, vue/multiline-html-element-content-newline */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AdminSidebar from '@/components/AdminSidebar.vue'
import {
  getReviewWork,
  listReviewWorks,
  regenerateReviewGif,
  reviewWork,
  safeReviewImage,
  takeReviewWorkOffShelf,
  type ReviewStatus,
  type ReviewWork
} from '@/features/admin-collab-review/api'
import './admin-collab-review.css'

const filters: Array<{ label: string; value: ReviewStatus | ''; dot?: string }> = [
  { label: '待审核', value: 'pending', dot: '#F5E642' },
  { label: '已通过', value: 'approved', dot: '#8FD694' },
  { label: '已拒绝', value: 'rejected', dot: '#FF6B35' },
  { label: '全部', value: '' }
]
const mobileOpen = ref(false)
const collapsed = ref(false)
const clock = ref('')
const filter = ref<ReviewStatus | ''>('pending')
const page = ref(1)
const works = ref<ReviewWork[]>([])
const total = ref(0)
const counts = ref<Record<string, number>>({})
const loading = ref(true)
const listError = ref('')
const detail = ref<ReviewWork | null>(null)
const drawerOpen = ref(false)
const detailLoading = ref(false)
const detailError = ref('')
const rejectOpen = ref(false)
const rejectReason = ref('')
const approveTarget = ref<ReviewWork | null>(null)
const busy = ref(false)
const notice = ref('')
let listSequence = 0
let detailSequence = 0
let clockTimer: number | undefined
let noticeTimer: number | undefined

const pages = computed(() => Math.ceil(total.value / 15))
const pageButtons = computed(() =>
  Array.from({ length: Math.min(pages.value, 10) }, (_, index) => index + 1)
)
const frameCount = computed(() => detail.value?.animationFrames?.length ?? 0)
const visibleFrames = computed(() => detail.value?.animationFrames?.slice(0, 10) ?? [])

function date(value?: string | null, withTime = false): string {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return withTime
    ? parsed.toLocaleString('zh-CN')
    : parsed.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', year: '2-digit' })
}
function statusLabel(status: string): string {
  return (
    (
      { pending: '⏳ 待审核', approved: '✅ 已通过', rejected: '❌ 已拒绝' } as Record<
        string,
        string
      >
    )[status] ?? status
  )
}
function flash(message: string): void {
  notice.value = message
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => {
    notice.value = ''
  }, 2800)
}
async function loadStats(): Promise<void> {
  try {
    const results = await Promise.all(filters.map((item) => listReviewWorks(item.value, 1, 1)))
    counts.value = Object.fromEntries(
      filters.map((item, index) => [item.value, results[index]?.total ?? 0])
    )
  } catch {
    counts.value = {}
  }
}
async function loadWorks(nextPage = page.value): Promise<void> {
  const sequence = ++listSequence
  page.value = nextPage
  loading.value = true
  listError.value = ''
  try {
    const result = await listReviewWorks(filter.value, nextPage)
    if (sequence !== listSequence) return
    works.value = result.works
    total.value = result.total
  } catch (error) {
    if (sequence !== listSequence) return
    works.value = []
    total.value = 0
    listError.value = error instanceof Error ? error.message : '加载失败，请刷新重试'
  } finally {
    if (sequence === listSequence) loading.value = false
  }
}
function setFilter(value: ReviewStatus | ''): void {
  filter.value = value
  void loadWorks(1)
}
function refresh(): void {
  void Promise.all([loadWorks(), loadStats()])
}
function hideBrokenImage(event: Event): void {
  if (event.target instanceof HTMLImageElement) event.target.style.display = 'none'
}
async function openDrawer(work: ReviewWork, reject = false): Promise<void> {
  const sequence = ++detailSequence
  drawerOpen.value = true
  detail.value = null
  detailLoading.value = true
  detailError.value = ''
  rejectOpen.value = reject
  rejectReason.value = ''
  try {
    const result = await getReviewWork(work.id)
    if (sequence !== detailSequence) return
    detail.value = result
  } catch (error) {
    if (sequence !== detailSequence) return
    detailError.value = error instanceof Error ? error.message : '加载失败'
  } finally {
    if (sequence === detailSequence) detailLoading.value = false
  }
}
function closeDrawer(): void {
  ++detailSequence
  drawerOpen.value = false
  detail.value = null
  rejectOpen.value = false
}
function confirmApprove(work: ReviewWork): void {
  approveTarget.value = work
}
async function submitReview(action: 'approve' | 'reject'): Promise<void> {
  const target = action === 'approve' ? approveTarget.value : detail.value
  if (!target || busy.value) return
  const reason = rejectReason.value.trim()
  if (action === 'reject' && !reason) {
    flash('请填写拒绝原因')
    return
  }
  busy.value = true
  try {
    await reviewWork(target.id, action, reason)
    flash(action === 'approve' ? '✓ 已通过' : '✓ 已拒绝')
    approveTarget.value = null
    closeDrawer()
    await Promise.all([loadStats(), loadWorks(page.value)])
  } catch (error) {
    flash(`操作失败：${error instanceof Error ? error.message : '网络错误'}`)
  } finally {
    busy.value = false
  }
}
async function regenerateGif(): Promise<void> {
  if (!detail.value || busy.value) return
  busy.value = true
  try {
    await regenerateReviewGif(detail.value.id)
    detail.value = await getReviewWork(detail.value.id)
    flash('GIF 生成成功')
  } catch (error) {
    flash(`GIF 生成失败：${error instanceof Error ? error.message : '网络错误'}`)
  } finally {
    busy.value = false
  }
}
async function shelfOff(): Promise<void> {
  if (!detail.value || busy.value) return
  if (
    !window.confirm(
      `确定要下架《${detail.value.title}》吗？下架后作品将从展示库中移除，创作者将收到通知。`
    )
  )
    return
  busy.value = true
  try {
    await takeReviewWorkOffShelf(detail.value.id)
    flash('已下架')
    closeDrawer()
    await Promise.all([loadStats(), loadWorks(page.value)])
  } catch (error) {
    flash(`操作失败：${error instanceof Error ? error.message : '网络错误'}`)
  } finally {
    busy.value = false
  }
}
watch(drawerOpen, (open) => {
  document.body.style.overflow = open ? 'hidden' : ''
})
onMounted(() => {
  const updateClock = () => {
    clock.value = new Date().toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }
  updateClock()
  clockTimer = window.setInterval(updateClock, 1000)
  void Promise.all([loadStats(), loadWorks(1)])
})
onBeforeUnmount(() => {
  window.clearInterval(clockTimer)
  window.clearTimeout(noticeTimer)
  document.body.style.overflow = ''
})
</script>

<template>
  <div class="admin-collab-review-page">
    <AdminSidebar v-model:collapsed="collapsed" v-model:mobile-open="mobileOpen" />
    <main class="review-main" :class="{ expanded: collapsed }">
      <header class="review-topbar">
        <button class="review-menu" type="button" aria-label="打开菜单" @click="mobileOpen = true">
          ☰
        </button>
        <span class="review-topbar-title">联名审核</span>
        <div class="review-topbar-right">
          <span class="review-time">{{ clock }}</span
          ><button class="review-btn ghost small" type="button" @click="refresh">↻ 刷新</button>
        </div>
      </header>
      <div class="review-content">
        <div class="review-stats">
          <button
            v-for="item in filters"
            :key="item.value"
            class="review-stat"
            :class="{ active: filter === item.value }"
            type="button"
            @click="setFilter(item.value)"
          >
            <span v-if="item.dot" class="review-stat-dot" :style="{ background: item.dot }"></span>
            <span class="review-stat-label">{{ item.label }}</span
            ><span class="review-stat-num">{{ counts[item.value] ?? '—' }}</span>
          </button>
        </div>
        <div class="review-tabs">
          <button
            v-for="item in filters"
            :key="item.value"
            class="review-tab"
            :class="{ active: filter === item.value }"
            type="button"
            @click="setFilter(item.value)"
          >
            {{
              item.value === 'pending'
                ? '⏳ '
                : item.value === 'approved'
                  ? '✅ '
                  : item.value === 'rejected'
                    ? '❌ '
                    : ''
            }}{{ item.label }}
          </button>
        </div>
        <div class="review-table">
          <div class="review-table-header">
            <div>作品</div>
            <div class="review-creator-col">创作者</div>
            <div>状态</div>
            <div class="review-date-col">申请时间</div>
            <div>操作</div>
          </div>
          <div v-if="loading" class="review-loading">正在加载…</div>
          <div v-else-if="listError" class="review-empty">
            <div class="review-empty-icon">❌</div>
            <div>{{ listError }}</div>
            <button class="review-btn ghost small" type="button" @click="loadWorks()">重试</button>
          </div>
          <div v-else-if="!works.length" class="review-empty">
            <div class="review-empty-icon">🤝</div>
            <div>暂无联名申请</div>
          </div>
          <div
            v-for="work in loading || listError ? [] : works"
            :key="work.id"
            class="review-work-row"
            tabindex="0"
            role="button"
            @click="openDrawer(work)"
            @keydown.enter="openDrawer(work)"
          >
            <div class="review-cover-wrap">
              <div class="review-cover">
                <img
                  v-if="safeReviewImage(work.coverUrl)"
                  :src="safeReviewImage(work.coverUrl)!"
                  alt=""
                  @error="hideBrokenImage"
                /><span v-else>📦</span>
              </div>
              <div class="review-work-info">
                <div class="review-work-title">{{ work.title }}</div>
                <div class="review-order">{{ work.orderNo || '' }}</div>
              </div>
            </div>
            <div class="review-creator-col review-creator">
              <span class="review-avatar">{{
                (work.creator?.nickname || '创作者').slice(0, 1).toUpperCase()
              }}</span
              ><span>{{ work.creator?.nickname || '创作者' }}</span>
            </div>
            <div>
              <span class="review-status" :class="work.status">{{ statusLabel(work.status) }}</span>
            </div>
            <div class="review-date-col review-date">{{ date(work.createdAt) }}</div>
            <div class="review-row-actions">
              <template v-if="work.status === 'pending'"
                ><button
                  class="review-btn green small"
                  type="button"
                  @click.stop="confirmApprove(work)"
                >
                  通过</button
                ><button
                  class="review-btn red small"
                  type="button"
                  @click.stop="openDrawer(work, true)"
                >
                  拒绝
                </button></template
              ><button
                v-else
                class="review-btn ghost small"
                type="button"
                @click.stop="openDrawer(work)"
              >
                查看
              </button>
            </div>
          </div>
          <div v-if="!loading && !listError && pages > 1" class="review-pagination">
            <span>共 {{ total }} 条 / 第 {{ page }} 页</span>
            <div>
              <button
                class="review-page-btn"
                type="button"
                :disabled="page <= 1"
                @click="loadWorks(page - 1)"
              >
                ‹</button
              ><button
                v-for="number in pageButtons"
                :key="number"
                class="review-page-btn"
                :class="{ active: page === number }"
                type="button"
                @click="loadWorks(number)"
              >
                {{ number }}</button
              ><button
                class="review-page-btn"
                type="button"
                :disabled="page >= pages"
                @click="loadWorks(page + 1)"
              >
                ›
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
    <div v-if="drawerOpen" class="review-drawer-overlay" @click="closeDrawer()"></div>
    <aside class="review-drawer" :class="{ open: drawerOpen }" aria-label="作品详情">
      <div class="review-drawer-header">
        <strong>{{ detail?.title || '作品详情' }}</strong
        ><button
          class="review-drawer-close"
          type="button"
          aria-label="关闭详情"
          @click="closeDrawer()"
        >
          ✕
        </button>
      </div>
      <div class="review-drawer-body">
        <div v-if="detailLoading" class="review-loading">加载中…</div>
        <div v-else-if="detailError" class="review-loading">{{ detailError }}</div>
        <template v-else-if="detail">
          <section class="review-section">
            <h2>作品信息</h2>
            <div class="review-detail-grid">
              <div>
                <span>作品名称</span><strong>{{ detail.title }}</strong>
              </div>
              <div>
                <span>状态</span
                ><strong
                  ><span class="review-status" :class="detail.status">{{
                    statusLabel(detail.status)
                  }}</span></strong
                >
              </div>
              <div>
                <span>关联订单</span><strong>{{ detail.orderNo || '—' }}</strong>
              </div>
              <div>
                <span>申请时间</span><strong>{{ date(detail.createdAt, true) }}</strong>
              </div>
              <div v-if="detail.status !== 'pending'">
                <span>审核时间</span><strong>{{ date(detail.approvedAt, true) }}</strong>
              </div>
              <div v-if="detail.rejectReason" class="review-full">
                <span>拒绝原因</span
                ><strong class="review-reason">{{ detail.rejectReason }}</strong>
              </div>
            </div>
            <p v-if="detail.description" class="review-description">{{ detail.description }}</p>
          </section>
          <section class="review-section">
            <h2>创作者信息</h2>
            <div class="review-detail-grid">
              <div>
                <span>创作者</span><strong>{{ detail.creator?.nickname || '—' }}</strong>
              </div>
            </div>
          </section>
          <section class="review-section">
            <h2>帧图预览（共 {{ frameCount }} 帧）</h2>
            <div v-if="frameCount" class="review-frames">
              <div v-for="(url, index) in visibleFrames" :key="index" class="review-frame">
                <img
                  v-if="safeReviewImage(url)"
                  :src="safeReviewImage(url)!"
                  :alt="`帧${index + 1}`"
                  @error="hideBrokenImage"
                /><span>{{ index + 1 }}</span>
              </div>
              <div v-if="frameCount > 10" class="review-frame review-frame-more">
                +{{ frameCount - 10 }}
              </div>
            </div>
            <div v-else class="review-no-frames">暂无帧图预览</div>
          </section>
          <section v-if="rejectOpen && detail.status === 'pending'" class="review-section">
            <h2 class="review-reason">填写拒绝原因</h2>
            <textarea
              v-model="rejectReason"
              class="review-textarea"
              placeholder="请填写拒绝原因，创作者将会看到此内容…"
            ></textarea>
          </section>
        </template>
      </div>
      <div v-if="detail" class="review-drawer-footer">
        <template v-if="detail.status === 'pending'"
          ><div class="review-footer-actions">
            <button
              class="review-btn red"
              type="button"
              :disabled="busy"
              @click="rejectOpen = true"
            >
              ✕ 拒绝</button
            ><button
              class="review-btn green"
              type="button"
              :disabled="busy"
              @click="confirmApprove(detail)"
            >
              ✓ 审核通过
            </button>
          </div>
          <button
            v-if="rejectOpen"
            class="review-btn red review-confirm-reject"
            type="button"
            :disabled="busy"
            @click="submitReview('reject')"
          >
            确认拒绝并提交
          </button></template
        >
        <div v-else-if="detail.status === 'approved'" class="review-approved-footer">
          <span
            >已通过审核{{ detail.isOnShelf ? '·已上架' : '·未上架' }} ·
            {{ detail.hoverGifUrl ? '✅ GIF已生成' : '⚠️ GIF未生成' }}</span
          >
          <div>
            <button
              class="review-btn ghost small"
              type="button"
              :disabled="busy"
              @click="regenerateGif()"
            >
              🎞 重新生成GIF</button
            ><button
              v-if="detail.isOnShelf"
              class="review-btn red small"
              type="button"
              :disabled="busy"
              @click="shelfOff()"
            >
              📦 下架
            </button>
          </div>
        </div>
        <div v-else class="review-rejected-footer">此作品已被拒绝，无法再次操作</div>
      </div>
    </aside>
    <div v-if="approveTarget" class="review-modal-overlay">
      <div class="review-modal">
        <h2>确认审核通过</h2>
        <p>通过后作品可进入联名商品配置流程，合作条款以内部合同记录为准。</p>
        <div>
          <button
            class="review-btn ghost"
            type="button"
            :disabled="busy"
            @click="approveTarget = null"
          >
            取消</button
          ><button
            class="review-btn green"
            type="button"
            :disabled="busy"
            @click="submitReview('approve')"
          >
            确认通过
          </button>
        </div>
      </div>
    </div>
    <div v-if="notice" class="review-toast" role="status">{{ notice }}</div>
  </div>
</template>
