<script setup lang="ts">
/* eslint-disable vue/html-closing-bracket-newline, vue/html-indent, vue/multiline-html-element-content-newline */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AdminSidebar from '@/components/AdminSidebar.vue'
import { useSessionStore } from '@/stores/session'
import {
  actOnDeletion,
  listDeletionTasks,
  type DeletionStatus,
  type DeletionTask
} from '@/features/admin-deletions/api'
import './admin-account-deletions.css'

const session = useSessionStore()
const mobileOpen = ref(false)
const collapsed = ref(false)
const statuses: Array<{ value: DeletionStatus | ''; label: string }> = [
  { value: '', label: '全部状态' },
  { value: 'REQUESTED', label: '保护期/待执行' },
  { value: 'PROCESSING', label: '清理中' },
  { value: 'FAILED', label: '自动重试' },
  { value: 'MANUAL_REVIEW', label: '待人工关注' },
  { value: 'PAUSED', label: '已暂停' },
  { value: 'BLOCKED', label: '存在未结事项' },
  { value: 'COMPLETED', label: '已完成' },
  { value: 'CANCELLED', label: '已撤销' }
]
const labels = Object.fromEntries(statuses.map((item) => [item.value, item.label]))
const status = ref<DeletionStatus | ''>('')
const searchInput = ref('')
const search = ref('')
const page = ref(1)
const total = ref(0)
const items = ref<DeletionTask[]>([])
const summary = ref<Record<string, number>>({})
const canManage = ref(false)
const loading = ref(true)
const error = ref('')
const notice = ref('')
const busy = ref(false)
const pauseTask = ref<DeletionTask | null>(null)
const pauseReason = ref('')
const pauseUserMessage = ref('')
let sequence = 0
let noticeTimer: number | undefined
const manager = computed(() => session.staffRole === 'OWNER' && canManage.value)
const pageCount = computed(() => Math.ceil(total.value / 20))
const metrics = computed(
  () =>
    [
      ['保护期内', summary.value.PROTECTION || 0],
      [
        '等待或清理中',
        Math.max(0, (summary.value.REQUESTED || 0) - (summary.value.PROTECTION || 0)) +
          (summary.value.PROCESSING || 0)
      ],
      ['自动重试', summary.value.FAILED || 0],
      ['需要关注或暂停', (summary.value.MANUAL_REVIEW || 0) + (summary.value.PAUSED || 0)],
      ['已完成', summary.value.COMPLETED || 0]
    ] as const
)

function dateTime(value: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN', { hour12: false })
}
function phase(task: DeletionTask): string {
  if (task.status === 'REQUESTED' && task.protectionMinutesLeft > 0)
    return `剩${task.protectionMinutesLeft}分钟可撤销`
  if (task.status === 'PAUSED') return task.canUserCancel ? '已暂停，可撤销' : '已暂停，不可撤销'
  return labels[task.status] || task.status
}
function alertText(task: DeletionTask): string {
  if (task.alertLevel === 'OVERDUE') return '超过48小时处理目标'
  if (task.alertLevel === 'URGENT') return '已超过24小时，请优先处理'
  if (task.alertLevel === 'ATTENTION') return '需要负责人关注'
  return ''
}
function reason(task: DeletionTask): string {
  if (task.status === 'PAUSED')
    return `内部：${task.pauseReason || '未填写'}\n用户：${task.pauseUserMessage || '通用提示'}`
  if (task.lastError) return task.lastError
  if (Array.isArray(task.blockers) && task.blockers.length)
    return task.blockers.map((item) => item.message).join('；')
  return '-'
}
function flash(value: string): void {
  notice.value = value
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => {
    notice.value = ''
  }, 2800)
}
async function loadTasks(nextPage = page.value): Promise<void> {
  const request = ++sequence
  loading.value = true
  error.value = ''
  try {
    const result = await listDeletionTasks(nextPage, status.value, search.value)
    if (request !== sequence) return
    items.value = result.items
    summary.value = result.summary
    canManage.value = result.canManage
    page.value = result.pagination.page
    total.value = result.pagination.total
  } catch (cause) {
    if (request !== sequence) return
    error.value = cause instanceof Error ? cause.message : '加载失败'
  } finally {
    if (request === sequence) loading.value = false
  }
}
function applySearch(): void {
  search.value = searchInput.value.trim()
  void loadTasks(1)
}
function changeStatus(event: Event): void {
  status.value = (event.target as HTMLSelectElement).value as DeletionStatus | ''
  void loadTasks(1)
}
async function act(task: DeletionTask, action: 'retry' | 'resume'): Promise<void> {
  if (!manager.value || busy.value) return
  if (!window.confirm(action === 'retry' ? '确认重新执行这项注销清理？' : '确认恢复这项注销任务？'))
    return
  busy.value = true
  let saved = false
  try {
    await actOnDeletion(task.id, action)
    saved = true
    await loadTasks()
    flash(
      action === 'retry'
        ? '已安排立即重试，通常会在1分钟内开始'
        : '注销任务已恢复，通常会在1分钟内开始'
    )
  } catch (cause) {
    flash(
      saved
        ? '操作已保存，但列表刷新失败，请重试刷新'
        : cause instanceof Error
          ? cause.message
          : '操作失败'
    )
  } finally {
    busy.value = false
  }
}
function openPause(task: DeletionTask): void {
  if (!manager.value || busy.value) return
  pauseTask.value = task
  pauseReason.value = ''
  pauseUserMessage.value = ''
}
async function submitPause(): Promise<void> {
  if (!manager.value || !pauseTask.value || busy.value) return
  const reason = pauseReason.value.trim()
  const userMessage = pauseUserMessage.value.trim()
  if (reason.length < 5) {
    flash('内部原因请填写至少5个字')
    return
  }
  if (userMessage.length < 5) {
    flash('给用户看的说明请填写至少5个字')
    return
  }
  busy.value = true
  let saved = false
  try {
    await actOnDeletion(pauseTask.value.id, 'pause', { reason, userMessage })
    saved = true
    pauseTask.value = null
    await loadTasks()
    flash('注销任务已暂停')
  } catch (cause) {
    flash(
      saved
        ? '操作已保存，但列表刷新失败，请重试刷新'
        : cause instanceof Error
          ? cause.message
          : '暂停失败'
    )
  } finally {
    busy.value = false
  }
}
onMounted(() => {
  void loadTasks()
})
onBeforeUnmount(() => window.clearTimeout(noticeTimer))
</script>

<template>
  <div class="admin-deletions-page">
    <AdminSidebar v-model:mobile-open="mobileOpen" v-model:collapsed="collapsed" />
    <main class="main" :class="{ expanded: collapsed }">
      <header class="topbar">
        <div class="topbar-left">
          <button
            class="menu-btn"
            type="button"
            aria-label="打开后台菜单"
            @click="mobileOpen = true"
          >
            ☰</button
          ><span class="topbar-title">注销任务管理</span>
        </div>
        <span class="note">{{
          manager ? '负责人：可查看并处理异常任务' : '运营客服：仅可查看脱敏状态'
        }}</span>
      </header>
      <div class="content">
        <section class="summary" aria-label="注销任务概览">
          <div v-for="[label, count] in metrics" :key="label" class="metric">
            <strong>{{ count }}</strong
            ><span>{{ label }}</span>
          </div>
        </section>
        <form class="toolbar" @submit.prevent="applySearch">
          <select class="select" aria-label="任务状态" :value="status" @change="changeStatus">
            <option v-for="option in statuses" :key="option.value" :value="option.value">
              {{ option.label }}
            </option></select
          ><input
            v-model="searchInput"
            class="input"
            aria-label="任务搜索"
            placeholder="输入完整手机号、昵称或任务编号"
          /><button class="btn btn-dark" type="submit">查询</button
          ><button class="btn" type="button" title="刷新任务列表" @click="loadTasks()">
            ↻ 刷新
          </button>
        </form>
        <div class="table-wrap">
          <div class="row head">
            <div>账号</div>
            <div>任务状态</div>
            <div>申请时间</div>
            <div>已用时间</div>
            <div>异常/暂停原因</div>
            <div>操作</div>
          </div>
          <div v-if="loading" class="empty">正在加载...</div>
          <div v-else-if="error" class="empty" role="alert">
            {{ error }} <button class="btn" type="button" @click="loadTasks()">重试</button>
          </div>
          <div v-else-if="!items.length" class="empty">没有符合条件的注销任务</div>
          <div v-for="task in !loading && !error ? items : []" :key="task.id" class="row">
            <div>
              <div class="name">{{ task.user?.nickname || '未设置昵称' }}</div>
              <div class="sub">{{ task.user?.phone || '手机号已清除' }}<br />{{ task.userId }}</div>
            </div>
            <div>
              <span class="badge" :class="`s-${task.status}`">{{ phase(task) }}</span
              ><span v-if="alertText(task)" class="alert">{{ alertText(task) }}</span>
            </div>
            <div class="sub">{{ dateTime(task.requestedAt) }}</div>
            <div>
              <div class="name">{{ task.elapsedHours }} 小时</div>
              <div class="sub">尝试 {{ task.attemptCount }} 次</div>
            </div>
            <div class="error">{{ reason(task) }}</div>
            <div class="actions">
              <span v-if="!manager" class="sub">只读</span
              ><template v-else
                ><button
                  v-if="task.status === 'FAILED' || task.status === 'MANUAL_REVIEW'"
                  class="btn"
                  type="button"
                  :disabled="busy"
                  @click="act(task, 'retry')"
                >
                  重试</button
                ><button
                  v-if="['REQUESTED', 'FAILED', 'MANUAL_REVIEW'].includes(task.status)"
                  class="btn btn-danger"
                  type="button"
                  :disabled="busy"
                  @click="openPause(task)"
                >
                  暂停</button
                ><button
                  v-if="task.status === 'PAUSED'"
                  class="btn btn-dark"
                  type="button"
                  :disabled="busy"
                  @click="act(task, 'resume')"
                >
                  恢复</button
                ><span
                  v-if="!['REQUESTED', 'FAILED', 'MANUAL_REVIEW', 'PAUSED'].includes(task.status)"
                  class="sub"
                  >无需操作</span
                ></template
              >
            </div>
          </div>
        </div>
        <div v-if="!loading && !error && total > 20" class="pagination">
          <span>共 {{ total }} 条，第 {{ page }}/{{ pageCount }} 页</span>
          <div>
            <button class="btn" type="button" :disabled="page <= 1" @click="loadTasks(page - 1)">
              上一页
            </button>
            <button
              class="btn"
              type="button"
              :disabled="page >= pageCount"
              @click="loadTasks(page + 1)"
            >
              下一页
            </button>
          </div>
        </div>
      </div>
    </main>
    <div
      v-if="pauseTask"
      class="modal-backdrop show"
      role="dialog"
      aria-modal="true"
      aria-label="暂停注销任务"
    >
      <div class="modal">
        <h2>暂停注销任务</h2>
        <p>
          仅在争议处理、依法保全或确有必要时暂停。内部原因不会展示给用户，用户说明请使用清楚、克制的表达。
        </p>
        <label for="pauseReason">内部处理原因</label
        ><textarea
          id="pauseReason"
          v-model="pauseReason"
          maxlength="500"
          placeholder="记录事实、处理依据和下一步，至少5个字"
        ></textarea
        ><label for="pauseUserMessage">给用户看的说明</label
        ><textarea
          id="pauseUserMessage"
          v-model="pauseUserMessage"
          maxlength="300"
          placeholder="例如：您有一项订单售后正在处理中，完成后将继续处理注销申请"
        ></textarea>
        <div class="modal-actions">
          <button class="btn" type="button" :disabled="busy" @click="pauseTask = null">取消</button
          ><button class="btn btn-danger" type="button" :disabled="busy" @click="submitPause">
            确认暂停
          </button>
        </div>
      </div>
    </div>
    <div v-if="notice" class="toast show" role="status">{{ notice }}</div>
  </div>
</template>
