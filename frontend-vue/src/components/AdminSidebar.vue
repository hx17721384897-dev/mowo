<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { runtimeConfig } from '@/config/runtime'
import { useSessionStore } from '@/stores/session'
import type { StaffRole } from '@/services/auth-session'

type MenuItem = {
  label: string
  icon: string
  file?: string
  to?: string
  key?: string
  children?: MenuItem[]
  roles: StaffRole[]
}
type MenuGroup = { key: string; label: string; icon: string; items: MenuItem[] }
const ownerProduction: StaffRole[] = ['OWNER', 'PRODUCTION']
const ownerService: StaffRole[] = ['OWNER', 'CUSTOMER_SERVICE']
const ownerCollab: StaffRole[] = ['OWNER', 'COLLAB_OPS']
const groups: MenuGroup[] = [
  {
    key: 'production',
    label: '生产',
    icon: '📦',
    items: [
      {
        label: '全部订单',
        icon: '📋',
        key: 'orders',
        roles: ownerProduction,
        children: [
          {
            label: '订单总览',
            icon: '▦',
            to: '/admin/orders',
            roles: ownerProduction
          },
          {
            label: '已付款',
            icon: '○',
            to: '/admin/orders?view=paid',
            roles: ownerProduction
          },
          {
            label: '待处理',
            icon: '↓',
            to: '/admin/orders?view=pending',
            roles: ownerProduction
          },
          {
            label: '处理中',
            icon: '⌁',
            to: '/admin/orders?view=locked',
            roles: ownerProduction
          },
          {
            label: '待生产',
            icon: '□',
            to: '/admin/orders?view=processing',
            roles: ownerProduction
          },
          {
            label: '生产中',
            icon: '↻',
            to: '/admin/orders?view=producing',
            roles: ownerProduction
          },
          {
            label: '待发货',
            icon: '✓',
            to: '/admin/orders?view=ready',
            roles: ownerProduction
          },
          {
            label: '已发货',
            icon: '→',
            to: '/admin/orders?view=shipped',
            roles: ownerProduction
          }
        ]
      },
      {
        label: '生产批次',
        icon: '▦',
        to: '/admin/production-batches',
        roles: ownerProduction
      },
      {
        label: '扫码作业',
        icon: '⌁',
        key: 'scan',
        roles: ownerProduction,
        children: [
          {
            label: '作业总览',
            icon: '▦',
            to: '/admin/production-scan#overview',
            roles: ownerProduction
          },
          {
            label: '帧包完成',
            icon: '1',
            to: '/admin/production-scan#frame',
            roles: ownerProduction
          },
          {
            label: '材料领用',
            icon: '2',
            to: '/admin/production-scan#material',
            roles: ownerProduction
          },
          {
            label: '单件配对',
            icon: '3',
            to: '/admin/production-scan#pairing',
            roles: ownerProduction
          },
          {
            label: '装箱发货',
            icon: '4',
            to: '/admin/production-scan#packing',
            roles: ownerProduction
          }
        ]
      },
      { label: '打印与裁切设置', icon: '↕', to: '/admin/print-production', roles: ['OWNER'] },
      { label: '外部订单导入', icon: '📥', to: '/admin/import', roles: ownerProduction }
    ]
  },
  {
    key: 'assets',
    label: '素材',
    icon: '🖼',
    items: [
      {
        label: '帧图资产库',
        icon: '▦',
        to: '/admin/frame-library',
        roles: ['OWNER', 'PRODUCTION', 'COLLAB_OPS']
      },
      { label: '帧图制作', icon: '✂', to: '/admin/frame-making', roles: ownerProduction },
      {
        label: '批量导入',
        icon: '⇧',
        to: '/admin/frame-imports',
        roles: ['OWNER']
      }
    ]
  },
  {
    key: 'product',
    label: '商品',
    icon: '🎯',
    items: [
      { label: '款式管理', icon: '🧩', to: '/admin/models', roles: ownerService },
      { label: '库存管理', icon: '📊', file: 'admin-inventory.html', roles: ownerProduction }
    ]
  },
  {
    key: 'customization',
    label: '定制',
    icon: '✂',
    items: [
      {
        label: '定制处理',
        icon: '☷',
        to: '/admin/customization-requests',
        roles: ['OWNER', 'CUSTOMER_SERVICE', 'PRODUCTION']
      }
    ]
  },
  {
    key: 'collab',
    label: '联名',
    icon: '🤝',
    items: [{ label: '联名作品', icon: '🎨', file: 'admin-collab-works.html', roles: ownerCollab }]
  },
  {
    key: 'ops',
    label: '运营',
    icon: '💌',
    items: [{ label: '联络留言', icon: '📨', to: '/admin/contact', roles: ownerService }]
  },
  {
    key: 'users',
    label: '用户',
    icon: '👥',
    items: [
      { label: '用户列表', icon: '👤', file: 'admin-users.html', roles: ownerService },
      { label: '注销任务', icon: '⚠', file: 'admin-account-deletions.html', roles: ownerService }
    ]
  },
  {
    key: 'system',
    label: '系统',
    icon: '⚙️',
    items: [{ label: '审计日志', icon: '📋', file: 'admin-logs.html', roles: ['OWNER'] }]
  }
]

const session = useSessionStore()
const route = useRoute()
const activeGroup = computed(() => {
  if (
    route.path === '/admin/orders' ||
    route.path === '/admin/production-batches' ||
    route.path === '/admin/production-scan' ||
    route.path === '/admin/print-production' ||
    route.path === '/admin/import'
  )
    return 'production'
  if (
    route.path === '/admin/frame-library' ||
    route.path.startsWith('/admin/frame-making') ||
    route.path === '/admin/frame-imports'
  )
    return 'assets'
  if (route.path === '/admin/models') return 'product'
  if (route.path.startsWith('/admin/collab-')) return 'collab'
  if (route.path === '/admin/contact') return 'ops'
  if (route.path === '/admin/logs') return 'system'
  if (route.path === '/admin/users' || route.path === '/admin/account-deletions') return 'users'
  return ''
})
const visibleGroups = computed(() =>
  groups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => session.staffRole && item.roles.includes(session.staffRole)
      )
    }))
    .filter((group) => group.items.length)
)
const openGroups = ref<string[]>(activeGroup.value ? [activeGroup.value] : [])
watch(activeGroup, (key) => {
  if (key && !openGroups.value.includes(key)) openGroups.value = [...openGroups.value, key]
})
const openNested = ref<string[]>(
  route.path === '/admin/orders'
    ? ['orders']
    : route.path === '/admin/production-scan'
      ? ['scan']
      : []
)
const collapsed = defineModel<boolean>('collapsed', { default: false })
const mobileOpen = defineModel<boolean>('mobileOpen', { default: false })
const displayName = computed(
  () => session.user?.profile?.nickname || session.user?.maskedPhone || '员工'
)
const roleLabel = computed(
  () =>
    ({
      OWNER: '负责人',
      CUSTOMER_SERVICE: '运营客服',
      PRODUCTION: '生产人员',
      COLLAB_OPS: '合作运营'
    })[session.staffRole ?? 'OWNER']
)
const legacyUrl = (file: string): string => `${runtimeConfig.legacyWebBase}/${file}`
function isActiveLegacy(file: string): boolean {
  const routes: Record<string, string> = {
    'admin-collab-works.html': '/admin/collab-works',
    'admin-users.html': '/admin/users',
    'admin-account-deletions.html': '/admin/account-deletions',
    'admin-logs.html': '/admin/logs'
  }
  return routes[file] === route.path
}
function isActiveScanChild(file: string): boolean {
  if (route.path !== '/admin/production-scan') return false
  const station = file.split('#')[1] || 'overview'
  return (route.hash.slice(1) || 'overview') === station
}

function toggleGroup(key: string): void {
  openGroups.value = openGroups.value.includes(key)
    ? openGroups.value.filter((item) => item !== key)
    : [...openGroups.value, key]
}
function toggleNested(key: string): void {
  openNested.value = openNested.value.includes(key)
    ? openNested.value.filter((item) => item !== key)
    : [...openNested.value, key]
}
</script>

<template>
  <div v-if="mobileOpen" class="admin-sidebar-backdrop" @click="mobileOpen = false"></div>
  <aside class="admin-sidebar" :class="{ collapsed, open: mobileOpen }" aria-label="管理后台导航">
    <div class="sidebar-logo">
      <div class="sidebar-logo-icon">🐄</div>
      <div>
        <div class="sidebar-logo-text">哞屋后台</div>
        <span class="sidebar-logo-sub">MOWO ADMIN</span>
      </div>
    </div>
    <button
      class="sidebar-toggle"
      type="button"
      :aria-label="collapsed ? '展开侧栏' : '收起侧栏'"
      @click="collapsed = !collapsed"
    >
      ‹
    </button>
    <nav class="sidebar-nav" aria-label="后台菜单">
      <div v-for="group in visibleGroups" :key="group.key" class="nav-group">
        <button
          class="nav-group-header"
          :class="{
            open: openGroups.includes(group.key),
            'active-group': group.key === activeGroup
          }"
          type="button"
          @click="toggleGroup(group.key)"
        >
          <span class="nav-icon">{{ group.icon }}</span
          ><span class="nav-label">{{ group.label }}</span
          ><span class="nav-group-arrow">▾</span>
        </button>
        <div class="nav-sub" :class="{ open: openGroups.includes(group.key) }">
          <template v-for="item in group.items" :key="item.file || item.key || item.to">
            <div v-if="item.children && item.key" class="nav-nested">
              <button
                class="nav-sub-parent"
                :class="{ open: openNested.includes(item.key) }"
                type="button"
                @click="toggleNested(item.key)"
              >
                <span class="nav-icon">{{ item.icon }}</span
                ><span class="nav-label">{{ item.label }}</span
                ><span class="nav-third-arrow">▾</span>
              </button>
              <div class="nav-third" :class="{ open: openNested.includes(item.key) }">
                <template v-for="child in item.children" :key="child.to || child.file">
                  <RouterLink
                    v-if="child.to"
                    class="nav-third-item"
                    :class="{
                      active:
                        route.fullPath === child.to ||
                        (route.path === '/admin/production-scan' &&
                          route.hash === child.to.split('/admin/production-scan')[1])
                    }"
                    :to="child.to"
                    @click="mobileOpen = false"
                    ><span class="nav-icon">{{ child.icon }}</span
                    ><span class="nav-label">{{ child.label }}</span></RouterLink
                  >
                  <a
                    v-else
                    class="nav-third-item"
                    :class="{ active: isActiveScanChild(child.file!) }"
                    :href="legacyUrl(child.file!)"
                    ><span class="nav-icon">{{ child.icon }}</span
                    ><span class="nav-label">{{ child.label }}</span></a
                  >
                </template>
              </div>
            </div>
            <RouterLink
              v-if="item.to"
              class="nav-sub-item"
              :class="{ active: route.path === item.to }"
              :to="item.to"
              @click="mobileOpen = false"
              ><span class="nav-icon">{{ item.icon }}</span
              ><span class="nav-label">{{ item.label }}</span></RouterLink
            >
            <a
              v-else-if="item.file"
              class="nav-sub-item"
              :class="{ active: isActiveLegacy(item.file) }"
              :href="legacyUrl(item.file)"
              ><span class="nav-icon">{{ item.icon }}</span
              ><span class="nav-label">{{ item.label }}</span></a
            >
          </template>
        </div>
      </div>
    </nav>
    <RouterLink class="sidebar-back" to="/"
      ><span class="nav-icon">🌐</span><span class="nav-label">返回前台</span></RouterLink
    >
    <div class="sidebar-footer">
      <div class="sidebar-user">
        <div class="sidebar-user-avatar">{{ displayName.slice(0, 1) }}</div>
        <div class="sidebar-user-info">
          <div class="sidebar-user-name">{{ displayName }}</div>
          <div class="sidebar-user-role">{{ roleLabel }}</div>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.admin-sidebar-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 190;
}
.admin-sidebar {
  width: 220px;
  min-height: 100vh;
  background: #111110;
  display: flex;
  flex-direction: column;
  position: fixed;
  left: 0;
  top: 0;
  bottom: 0;
  z-index: 100;
  transition: width 0.3s cubic-bezier(0.22, 1, 0.36, 1);
  overflow: hidden;
  color: #787874;
  font-family: 'Nunito', 'Noto Sans SC', sans-serif;
}
.admin-sidebar.collapsed {
  width: 60px;
}
.sidebar-logo {
  padding: 24px 20px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  align-items: center;
  gap: 10px;
  white-space: nowrap;
  overflow: hidden;
}
.sidebar-logo-icon {
  width: 32px;
  height: 32px;
  background: #f5e642;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
}
.sidebar-logo-text {
  font-weight: 900;
  font-size: 15px;
  color: #fff;
  letter-spacing: 0.04em;
}
.sidebar-logo-sub {
  font-weight: 700;
  font-size: 10px;
  color: #787874;
  letter-spacing: 0.1em;
  display: block;
  margin-top: 1px;
}
.sidebar-toggle {
  position: absolute;
  top: 26px;
  right: 12px;
  width: 28px;
  height: 28px;
  background: rgba(255, 255, 255, 0.08);
  border: 0;
  border-radius: 6px;
  color: #787874;
  cursor: pointer;
}
.sidebar-nav {
  flex: 1;
  padding: 12px 0;
  overflow-y: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
  min-height: 0;
}
.sidebar-nav::-webkit-scrollbar {
  display: none;
}
.nav-group-header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 20px;
  border: 0;
  background: none;
  color: #787874;
  font:
    800 13px 'Nunito',
    'Noto Sans SC',
    sans-serif;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
}
.nav-group-header:hover,
.nav-group-header.open {
  color: #fff;
}
.nav-group-header.active-group {
  color: #f5e642;
}
.nav-icon {
  font-size: 16px;
  flex-shrink: 0;
  width: 20px;
  text-align: center;
}
.nav-label {
  white-space: nowrap;
}
.nav-group-arrow {
  margin-left: auto;
  font-size: 10px;
  transition: transform 0.2s;
}
.nav-group-header.open .nav-group-arrow {
  transform: rotate(180deg);
}
.nav-sub {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.3s;
}
.nav-sub.open {
  max-height: 720px;
}
.nav-sub-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 20px 8px 44px;
  color: #787874;
  font-weight: 700;
  font-size: 12.5px;
  text-decoration: none;
  white-space: nowrap;
}
.nav-sub-item:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}
.nav-sub-item.active {
  color: #f5e642;
  background: rgba(245, 230, 66, 0.12);
  font-weight: 800;
  border-left: 3px solid #f5e642;
  padding-left: 41px;
}
.nav-sub-item .nav-icon {
  font-size: 13px;
  width: 16px;
}
.nav-sub-parent {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 20px 8px 44px;
  border: 0;
  background: transparent;
  color: #787874;
  font:
    700 12.5px 'Nunito',
    'Noto Sans SC',
    sans-serif;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}
.nav-sub-parent:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}
.nav-sub-parent .nav-icon {
  font-size: 13px;
  width: 16px;
}
.nav-third-arrow {
  margin-left: auto;
  font-size: 9px;
  opacity: 0.6;
  transition: transform 0.2s;
}
.nav-sub-parent.open .nav-third-arrow {
  transform: rotate(180deg);
}
.nav-third {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.25s;
  background: rgba(255, 255, 255, 0.018);
}
.nav-third.open {
  max-height: 420px;
}
.nav-third-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 18px 7px 64px;
  color: #787874;
  font-weight: 700;
  font-size: 11.5px;
  text-decoration: none;
  white-space: nowrap;
}
.nav-third-item:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}
.nav-third-item .nav-icon {
  width: 14px;
  font-size: 11px;
}
.sidebar-back {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  color: #787874;
  font-weight: 800;
  font-size: 13px;
  text-decoration: none;
  white-space: nowrap;
}
.sidebar-footer {
  padding: 16px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.sidebar-user {
  display: flex;
  align-items: center;
  gap: 10px;
}
.sidebar-user-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #f5e642;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 900;
  font-size: 13px;
  color: #111110;
  flex-shrink: 0;
}
.sidebar-user-name {
  font-weight: 800;
  font-size: 12px;
  color: #fff;
}
.sidebar-user-role {
  font-weight: 700;
  font-size: 10px;
}
.collapsed .nav-label,
.collapsed .nav-group-arrow,
.collapsed .sidebar-user-info {
  display: none;
}
.collapsed .nav-sub {
  max-height: 0;
}
@media (max-width: 1023px) {
  .admin-sidebar,
  .admin-sidebar.collapsed {
    width: min(220px, calc(100vw - 48px));
    height: 100dvh;
    min-height: 0;
    z-index: 200;
    transform: translateX(-100%);
  }
  .admin-sidebar.open {
    transform: none;
  }
  .collapsed .nav-label,
  .collapsed .nav-group-arrow,
  .collapsed .sidebar-user-info {
    display: block;
  }
  .collapsed .nav-sub.open {
    max-height: 720px;
  }
}
</style>
