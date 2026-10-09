<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AdminSidebar from '@/components/AdminSidebar.vue'
import { listOperationLogs, type OperationLog } from '@/features/admin-logs/api'
import type { StaffRole } from '@/services/auth-session'
import './admin-logs.css'

const mobileOpen = ref(false)
const collapsed = ref(false)
const method = ref('')
const outcome = ref('')
const search = ref('')
const page = ref(1)
const total = ref(0)
const logs = ref<OperationLog[]>([])
const expanded = ref<string[]>([])
const loading = ref(true)
const error = ref('')
let sequence = 0
const roleLabels: Record<StaffRole, string> = {
  OWNER: '负责人',
  CUSTOMER_SERVICE: '运营客服',
  PRODUCTION: '生产人员',
  COLLAB_OPS: '合作运营'
}
const outcomeLabels: Record<string, string> = { SUCCESS: '成功', FAILED: '失败', DENIED: '已拒绝' }
const visibleLogs = computed(() => {
  const term = search.value.trim().toLowerCase()
  return term
    ? logs.value.filter(
        (log) =>
          (log.action || '').toLowerCase().includes(term) ||
          log.path.toLowerCase().includes(term) ||
          (log.targetId || '').toLowerCase().includes(term)
      )
    : logs.value
})
const pageCount = computed(() => Math.ceil(total.value / 50))
const pageNumbers = computed(() =>
  Array.from({ length: Math.min(pageCount.value, 10) }, (_, i) => i + 1)
)
function date(value: string): { day: string; time: string } {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return { day: '', time: '' }
  return {
    day: parsed.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }),
    time: parsed.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }
}
function toggleDetail(id: string): void {
  expanded.value = expanded.value.includes(id)
    ? expanded.value.filter((item) => item !== id)
    : [...expanded.value, id]
}
async function loadLogs(nextPage = page.value): Promise<void> {
  const request = ++sequence
  loading.value = true
  error.value = ''
  try {
    const result = await listOperationLogs(nextPage, method.value, outcome.value)
    if (request !== sequence) return
    logs.value = result.logs
    page.value = result.pagination.page
    total.value = result.pagination.total
    expanded.value = []
  } catch (cause) {
    if (request !== sequence) return
    error.value = cause instanceof Error ? cause.message : '加载失败'
  } finally {
    if (request === sequence) loading.value = false
  }
}
function changeMethod(event: Event): void {
  method.value = (event.target as HTMLSelectElement).value
  void loadLogs(1)
}
function changeOutcome(event: Event): void {
  outcome.value = (event.target as HTMLSelectElement).value
  void loadLogs(1)
}
onMounted(() => {
  void loadLogs()
})
</script>

<template>
  <div class="admin-logs-page">
    <AdminSidebar v-model:mobile-open="mobileOpen" v-model:collapsed="collapsed" />
    <div class="main" :class="{ expanded: collapsed }">
      <header class="topbar">
        <button class="menu-btn" type="button" aria-label="打开后台菜单" @click="mobileOpen = true">
          ☰</button
        ><span class="topbar-title">审计日志</span>
        <div class="topbar-right">
          <span class="topbar-note">仅超级管理员可查看</span
          ><button class="btn btn-ghost btn-sm" type="button" @click="loadLogs()">↻ 刷新</button>
        </div>
      </header>
      <div class="content">
        <div class="filter-bar">
          <select
            class="filter-select"
            aria-label="操作类型"
            :value="method"
            @change="changeMethod"
          >
            <option value="">全部操作</option>
            <option value="POST">POST — 新增</option>
            <option value="PUT">PUT — 修改</option>
            <option value="DELETE">DELETE — 删除</option>
            <option value="GET">GET — 查询</option></select
          ><select
            class="filter-select"
            aria-label="操作结果"
            :value="outcome"
            @change="changeOutcome"
          >
            <option value="">全部结果</option>
            <option value="SUCCESS">成功</option>
            <option value="FAILED">失败</option>
            <option value="DENIED">已拒绝</option></select
          ><input
            v-model="search"
            class="search-input"
            type="search"
            aria-label="搜索操作内容"
            placeholder="搜索操作内容…"
          /><span class="log-count">共 {{ total }} 条记录</span>
        </div>
        <div class="log-list">
          <div v-if="loading" class="empty-state">
            <div class="empty-icon">⏳</div>
            <div class="empty-text">加载中…</div>
          </div>
          <div v-else-if="error" class="empty-state" role="alert">
            <div class="empty-icon">❌</div>
            <div class="empty-text">{{ error }}</div>
            <button class="btn btn-ghost btn-sm" type="button" @click="loadLogs()">重试</button>
          </div>
          <div v-else-if="!visibleLogs.length" class="empty-state">
            <div class="empty-icon">📭</div>
            <div class="empty-text">暂无日志记录</div>
          </div>
          <div v-for="log in !loading && !error ? visibleLogs : []" :key="log.id" class="log-item">
            <div class="log-time">
              <div class="log-time-date">{{ date(log.createdAt).day }}</div>
              <div>{{ date(log.createdAt).time }}</div>
              <div v-if="log.ip" class="log-time-ip">{{ log.ip }}</div>
            </div>
            <div class="log-content">
              <div class="log-action">{{ log.action || log.path }}</div>
              <div class="log-meta">
                <span class="method-badge" :class="`method-${log.method}`">{{ log.method }}</span
                ><span class="role-chip" :class="`role-chip-${log.userRole}`">{{
                  log.actor?.staffRole ? roleLabels[log.actor.staffRole] : '系统'
                }}</span
                ><span class="log-path">{{ log.path }}</span
                ><span class="log-ip"
                  >结果：{{ outcomeLabels[log.outcome || ''] || log.outcome || '成功'
                  }}{{ log.statusCode ? ` (${log.statusCode})` : '' }}</span
                ><span v-if="log.targetId" class="log-ip"
                  >对象：{{ log.targetId.slice(0, 20)
                  }}{{ log.targetId.length > 20 ? '…' : '' }}</span
                >
              </div>
              <button
                v-if="log.before || log.after"
                class="log-toggle"
                type="button"
                @click="toggleDetail(log.id)"
              >
                {{ expanded.includes(log.id) ? '收起详情 ▴' : '展开详情 ▾' }}
              </button>
              <div
                v-if="(log.before || log.after) && expanded.includes(log.id)"
                class="log-detail show"
              >
                <pre>{{
                  [
                    log.before ? `修改前：${log.before}` : '',
                    log.after ? `修改后：${log.after}` : ''
                  ]
                    .filter(Boolean)
                    .join('\n')
                }}</pre>
              </div>
            </div>
            <div class="log-actor">
              {{ log.actor?.name || (log.userId === 'system' ? '系统' : '未知员工') }}<br />{{
                log.actor?.maskedPhone || ''
              }}
            </div>
          </div>
        </div>
        <div v-if="!loading && !error && total > 50" class="pagination">
          <span class="pagination-info">共 {{ total }} 条 / 第 {{ page }} 页</span>
          <div class="pagination-btns">
            <button
              v-for="number in pageNumbers"
              :key="number"
              class="page-btn"
              :class="{ active: number === page }"
              type="button"
              @click="loadLogs(number)"
            >
              {{ number }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
