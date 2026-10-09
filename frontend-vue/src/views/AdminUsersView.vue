<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AdminSidebar from '@/components/AdminSidebar.vue'
import { useSessionStore } from '@/stores/session'
import type { StaffRole } from '@/services/auth-session'
import {
  listManagedUsers,
  setManagedBan,
  setManagedStaffRole,
  type ManagedUser
} from '@/features/admin-users/api'
import './admin-users.css'

const route = useRoute()
const session = useSessionStore()
const mobileOpen = ref(false)
const collapsed = ref(false)
const filters: Array<{ label: string; role: StaffRole | 'USER' | '' }> = [
  { label: '全部账号', role: '' },
  { label: '普通用户', role: 'USER' },
  { label: '运营客服', role: 'CUSTOMER_SERVICE' },
  { label: '生产人员', role: 'PRODUCTION' },
  { label: '合作运营', role: 'COLLAB_OPS' },
  { label: '负责人', role: 'OWNER' }
]
const roleLabels: Record<StaffRole, string> = {
  OWNER: '负责人',
  CUSTOMER_SERVICE: '运营客服',
  PRODUCTION: '生产人员',
  COLLAB_OPS: '合作运营'
}
const statusLabels: Record<string, string> = {
  ACTIVE: '正常',
  LIMITED: '受限',
  SUSPENDED: '停用',
  PENDING_DELETE: '注销处理中',
  DELETED: '已注销'
}
const activeRole = ref<StaffRole | 'USER' | ''>('')
const page = ref(1)
const total = ref(0)
const users = ref<ManagedUser[]>([])
const search = ref('')
const loading = ref(true)
const error = ref('')
const notice = ref('')
const busy = ref(false)
const modal = ref<'role' | 'ban' | null>(null)
const target = ref<ManagedUser | null>(null)
const selectedRole = ref<StaffRole | ''>('')
let sequence = 0
let noticeTimer: number | undefined
let highlightTimer: number | undefined
const highlightedId = ref('')

const isOwner = computed(() => session.staffRole === 'OWNER')
const visibleUsers = computed(() => {
  const term = search.value.trim().toLowerCase()
  return term
    ? users.value.filter(
        (user) =>
          (user.phone || '').includes(term) ||
          (user.profile?.nickname || '').toLowerCase().includes(term)
      )
    : users.value
})
const pageCount = computed(() => Math.ceil(total.value / 20))
const pageNumbers = computed(() =>
  Array.from({ length: Math.min(pageCount.value, 10) }, (_, i) => i + 1)
)

function safeAvatar(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value, location.origin)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}
function registrationDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', year: '2-digit' })
}
function flash(message: string): void {
  notice.value = message
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => {
    notice.value = ''
  }, 2800)
}
async function loadUsers(nextPage = page.value): Promise<void> {
  const request = ++sequence
  loading.value = true
  error.value = ''
  try {
    const result = await listManagedUsers(nextPage, activeRole.value)
    if (request !== sequence) return
    users.value = result.users
    page.value = result.pagination.page
    total.value = result.pagination.total
  } catch (cause) {
    if (request !== sequence) return
    error.value = cause instanceof Error ? cause.message : '加载失败，请刷新重试'
  } finally {
    if (request === sequence) loading.value = false
  }
}
async function highlightUser(id: string): Promise<void> {
  for (let current = 1; current <= 20; current++) {
    const request = ++sequence
    try {
      const result = await listManagedUsers(current, '')
      if (request !== sequence) return
      users.value = result.users
      page.value = current
      total.value = result.pagination.total
      if (result.users.some((user) => user.id === id)) {
        loading.value = false
        highlightedId.value = id
        await nextTick()
        document
          .getElementById(`user-row-${id}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        highlightTimer = window.setTimeout(() => {
          highlightedId.value = ''
        }, 3000)
        return
      }
      if (result.users.length < 20) break
    } catch {
      break
    }
  }
  await loadUsers(1)
}
function selectFilter(role: StaffRole | 'USER' | ''): void {
  activeRole.value = role
  void loadUsers(1)
}
function canEditRole(user: ManagedUser): boolean {
  return isOwner.value && user.id !== session.user?.id
}
function canBan(user: ManagedUser): boolean {
  return (
    user.id !== session.user?.id && user.staffRole !== 'OWNER' && (isOwner.value || !user.staffRole)
  )
}
function openRole(user: ManagedUser): void {
  if (!canEditRole(user)) return
  target.value = user
  selectedRole.value = user.staffRole || ''
  modal.value = 'role'
}
function openBan(user: ManagedUser): void {
  if (!canBan(user)) return
  target.value = user
  modal.value = 'ban'
}
async function saveRole(): Promise<void> {
  if (!target.value || busy.value || !canEditRole(target.value)) return
  busy.value = true
  let saved = false
  try {
    await setManagedStaffRole(target.value.id, selectedRole.value || null)
    saved = true
    modal.value = null
    await loadUsers()
    flash(`岗位已修改为「${selectedRole.value ? roleLabels[selectedRole.value] : '普通用户'}」`)
  } catch (cause) {
    flash(
      saved
        ? '岗位已保存，但列表刷新失败，请重试刷新'
        : `修改失败：${cause instanceof Error ? cause.message : '请重试'}`
    )
  } finally {
    busy.value = false
  }
}
async function saveBan(): Promise<void> {
  if (!target.value || busy.value || !canBan(target.value)) return
  busy.value = true
  let saved = false
  const action = target.value.isBanned ? '解封' : '封禁'
  try {
    await setManagedBan(target.value.id, !target.value.isBanned)
    saved = true
    modal.value = null
    await loadUsers()
    flash(`用户已${action}`)
  } catch (cause) {
    flash(
      saved
        ? '操作已保存，但列表刷新失败，请重试刷新'
        : `操作失败：${cause instanceof Error ? cause.message : '请重试'}`
    )
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  const id = typeof route.query.highlight === 'string' ? route.query.highlight : ''
  if (id) void highlightUser(id)
  else void loadUsers()
})
watch(
  () => route.query.highlight,
  (value) => {
    if (typeof value === 'string' && value) void highlightUser(value)
  }
)
onBeforeUnmount(() => {
  window.clearTimeout(noticeTimer)
  window.clearTimeout(highlightTimer)
})
</script>

<template>
  <div class="admin-users-page">
    <AdminSidebar v-model:mobile-open="mobileOpen" v-model:collapsed="collapsed" />
    <div class="main" :class="{ expanded: collapsed }">
      <header class="topbar">
        <button class="menu-btn" type="button" aria-label="打开后台菜单" @click="mobileOpen = true">
          ☰
        </button>
        <span class="topbar-title">用户管理</span>
        <div class="topbar-right">
          <button class="btn btn-ghost btn-sm" type="button" @click="loadUsers()">↻ 刷新</button>
        </div>
      </header>
      <div class="content">
        <div class="filter-tabs">
          <button
            v-for="item in filters"
            :key="item.label"
            class="filter-tab"
            :class="{ active: activeRole === item.role }"
            type="button"
            :aria-pressed="activeRole === item.role"
            @click="selectFilter(item.role)"
          >
            {{ item.label }}
          </button>
        </div>
        <div class="search-wrap">
          <input
            v-model="search"
            class="search-input"
            type="search"
            aria-label="搜索手机号或昵称"
            placeholder="搜索手机号或昵称…"
          />
        </div>
        <div class="table-wrap">
          <div class="table-header">
            <div></div>
            <div>用户信息</div>
            <div class="col-role">角色</div>
            <div class="col-time">注册时间</div>
            <div>操作</div>
          </div>
          <div v-if="loading" class="empty-state">
            <div class="empty-icon">⏳</div>
            <div class="empty-text">加载中…</div>
          </div>
          <div v-else-if="error" class="empty-state" role="alert">
            <div class="empty-icon">❌</div>
            <div class="empty-text">{{ error }}</div>
            <button class="btn btn-ghost btn-sm" type="button" @click="loadUsers()">重试</button>
          </div>
          <div v-else-if="!visibleUsers.length" class="empty-state">
            <div class="empty-icon">👤</div>
            <div class="empty-text">暂无用户</div>
          </div>
          <div
            v-for="user in !loading && !error ? visibleUsers : []"
            :id="`user-row-${user.id}`"
            :key="user.id"
            class="user-row"
            :class="{ highlighted: highlightedId === user.id }"
          >
            <div class="user-avatar">
              <img
                v-if="safeAvatar(user.profile?.avatarUrl)"
                :src="safeAvatar(user.profile?.avatarUrl) || ''"
                alt=""
              /><template v-else>{{ (user.profile?.nickname || user.phone || '用')[0] }}</template>
            </div>
            <div class="user-info">
              <div class="user-name">
                {{ user.profile?.nickname || '未设置昵称'
                }}<span v-if="user.isBanned" class="banned-tag">已封禁</span
                ><span
                  v-if="user.status !== 'ACTIVE'"
                  class="account-status-tag"
                  :class="
                    user.status === 'PENDING_DELETE'
                      ? 'pending'
                      : user.status === 'DELETED'
                        ? 'deleted'
                        : 'restricted'
                  "
                  >{{ statusLabels[user.status] || user.status }}</span
                >
              </div>
              <div class="user-phone">{{ user.phone || '未绑定手机号' }}</div>
            </div>
            <div class="col-role">
              <span
                class="role-badge"
                :class="
                  user.staffRole === 'OWNER'
                    ? 'role-3'
                    : user.staffRole === 'PRODUCTION'
                      ? 'role-1'
                      : user.staffRole
                        ? 'role-2'
                        : 'role-0'
                "
                >{{ user.staffRole ? roleLabels[user.staffRole] : '普通用户' }}</span
              >
            </div>
            <div class="col-time">{{ registrationDate(user.createdAt) }}</div>
            <div class="row-actions">
              <button
                v-if="canEditRole(user)"
                class="btn btn-ghost btn-sm"
                type="button"
                @click="openRole(user)"
              >
                设岗位</button
              ><button
                v-if="canBan(user)"
                class="btn btn-sm"
                :class="user.isBanned ? 'btn-ghost' : 'btn-red'"
                type="button"
                @click="openBan(user)"
              >
                {{ user.isBanned ? '解封' : '封禁' }}
              </button>
            </div>
          </div>
          <div v-if="!loading && !error && total > 20" class="pagination">
            <span class="pagination-info">共 {{ total }} 位用户 / 第 {{ page }} 页</span>
            <div class="pagination-btns">
              <button
                v-for="number in pageNumbers"
                :key="number"
                class="page-btn"
                :class="{ active: number === page }"
                type="button"
                @click="loadUsers(number)"
              >
                {{ number }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div
      v-if="modal === 'role' && target"
      class="modal-overlay show"
      role="dialog"
      aria-modal="true"
      aria-label="设置员工岗位"
    >
      <div class="modal">
        <p class="modal-title">设置员工岗位</p>
        <p class="modal-sub">
          账号：{{ target.profile?.nickname || target.phone || '未知' }} 当前岗位：{{
            target.staffRole ? roleLabels[target.staffRole] : '普通用户'
          }}
        </p>
        <div class="form-field">
          <label class="form-label" for="newStaffRole">岗位模板</label
          ><select id="newStaffRole" v-model="selectedRole" class="form-select">
            <option value="">普通用户（移除员工权限）</option>
            <option value="CUSTOMER_SERVICE">运营客服</option>
            <option value="PRODUCTION">生产人员</option>
            <option value="COLLAB_OPS">合作运营</option>
            <option value="OWNER">负责人</option>
          </select>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" type="button" :disabled="busy" @click="modal = null">
            取消</button
          ><button class="btn btn-yellow" type="button" :disabled="busy" @click="saveRole">
            确认修改
          </button>
        </div>
      </div>
    </div>
    <div
      v-if="modal === 'ban' && target"
      class="modal-overlay show"
      role="dialog"
      aria-modal="true"
      :aria-label="`确认${target.isBanned ? '解封' : '封禁'}用户`"
    >
      <div class="modal">
        <p class="modal-title">确认{{ target.isBanned ? '解封' : '封禁' }}用户</p>
        <p class="modal-sub">
          确定要{{ target.isBanned ? '解封' : '封禁' }}用户「{{
            target.profile?.nickname || target.phone || '该账号'
          }}」吗？{{ target.isBanned ? '' : '封禁后该用户将无法登录。' }}
        </p>
        <div class="modal-actions">
          <button class="btn btn-ghost" type="button" :disabled="busy" @click="modal = null">
            取消</button
          ><button
            class="btn"
            :class="target.isBanned ? 'btn-black' : 'btn-red'"
            type="button"
            :disabled="busy"
            @click="saveBan"
          >
            确认{{ target.isBanned ? '解封' : '封禁' }}
          </button>
        </div>
      </div>
    </div>
    <div v-if="notice" class="toast show" role="status">{{ notice }}</div>
  </div>
</template>
