<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { logoutCurrentDevice } from '@/features/account/api'
import AuthDialog from '@/features/auth/AuthDialog.vue'
import { safeInternalRedirect } from '@/router/safe-redirect'
import { useSessionStore } from '@/stores/session'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const menuOpen = ref(false)
const userMenuOpen = ref(false)
const authOpen = ref(false)
const userMenu = ref<HTMLElement | null>(null)
const authIntro = computed(() =>
  route.query.session === 'unavailable'
    ? '暂时无法确认原有登录状态。你可以重新登录后继续，系统不会自动创建订单或付款。'
    : undefined
)
const nickname = computed(() => session.user?.profile?.nickname || session.user?.nickname || '用户')
const avatarUrl = computed(
  () => session.user?.profile?.avatarUrl || session.user?.avatarUrl || null
)
const avatarInitial = computed(() => nickname.value.trim().charAt(0).toUpperCase() || '?')
const roleBadge = computed(() => {
  const role = session.user?.role ?? 0
  if (role >= 3) return { label: '⭐ 超级管理员', style: 'background:#FCE4EC;color:#C62828;' }
  if (role === 2) return { label: '🛡 管理员', style: 'background:#FFF8E1;color:#B8860B;' }
  return { label: '普通用户', style: '' }
})
const isStaff = computed(() => Boolean(session.staffRole))

watch(
  () => route.fullPath,
  () => {
    menuOpen.value = false
    userMenuOpen.value = false
  }
)

watch(menuOpen, (open) => {
  document.body.style.overflow = open ? 'hidden' : ''
})

watch(
  () => route.query.auth,
  (auth) => {
    if (auth === '1') authOpen.value = true
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  document.body.style.overflow = ''
  document.removeEventListener('pointerdown', closeUserMenuOutside)
  document.removeEventListener('keydown', closeUserMenuOnEscape)
})

async function openAccount(): Promise<void> {
  menuOpen.value = false
  await session.bootstrap()
  if (session.isAuthenticated) {
    await router.push('/account')
    return
  }
  authOpen.value = true
}

function toggleUserMenu(): void {
  userMenuOpen.value = !userMenuOpen.value
}

function closeUserMenuOutside(event: PointerEvent): void {
  if (!userMenu.value?.contains(event.target as Node)) userMenuOpen.value = false
}

function closeUserMenuOnEscape(event: KeyboardEvent): void {
  if (event.key === 'Escape') userMenuOpen.value = false
}

watch(userMenuOpen, (open) => {
  if (open) {
    document.addEventListener('pointerdown', closeUserMenuOutside)
    document.addEventListener('keydown', closeUserMenuOnEscape)
  } else {
    document.removeEventListener('pointerdown', closeUserMenuOutside)
    document.removeEventListener('keydown', closeUserMenuOnEscape)
  }
})

async function signOut(): Promise<void> {
  userMenuOpen.value = false
  try {
    await logoutCurrentDevice()
  } catch {
    // 服务端暂时不可达时也必须清除当前浏览器凭证，避免继续显示伪登录状态。
  } finally {
    session.reset()
    if (route.matched.some((record) => record.meta.requiresAuth === true)) await router.replace('/')
  }
}

async function handleAuthenticated(): Promise<void> {
  authOpen.value = false
  const target = safeInternalRedirect(route.query.redirect, route.path)
  await router.replace(target)
}
</script>

<template>
  <nav id="mowo-nav" aria-label="主导航">
    <div class="mowo-nav-left">
      <button
        class="mowo-menu-btn"
        type="button"
        aria-label="打开或关闭导航"
        :aria-expanded="menuOpen"
        aria-controls="mowo-mobile-menu"
        @click="menuOpen = true"
      >
        <svg viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
      </button>
      <RouterLink to="/" class="mowo-logo" @click="menuOpen = false">
        <span class="mowo-logo-mark">M</span>
        <span class="mowo-logo-text">MOWOBOX<span class="mowo-logo-sub">哞屋造物</span></span>
      </RouterLink>
    </div>
    <div class="mowo-nav-mid">
      <RouterLink to="/about" @click="menuOpen = false">关于我们</RouterLink>
      <RouterLink to="/products" @click="menuOpen = false">动盒系列</RouterLink>
      <RouterLink to="/showcase" @click="menuOpen = false">联名作品</RouterLink>
      <RouterLink to="/customize">创作中心</RouterLink>
      <RouterLink to="/contact" @click="menuOpen = false">联络我们</RouterLink>
    </div>
    <div class="mowo-nav-right">
      <RouterLink class="mowo-nav-icon" to="/showcase" aria-label="搜索">
        <svg viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </RouterLink>
      <RouterLink class="mowo-nav-icon mowo-cart-btn" to="/cart" data-count="0" aria-label="购物车">
        <svg viewBox="0 0 24 24">
          <path d="M3 4h2l2.5 12h11l2.5-9H6" />
          <circle cx="9" cy="20" r="1.6" />
          <circle cx="18" cy="20" r="1.6" />
        </svg>
      </RouterLink>
      <div
        v-if="session.isAuthenticated"
        ref="userMenu"
        class="nav-user show"
        :class="{ 'is-admin': isStaff }"
      >
        <button
          class="nav-avatar-btn"
          :class="{ open: userMenuOpen }"
          type="button"
          aria-label="打开个人中心菜单"
          :aria-expanded="userMenuOpen"
          aria-controls="mowo-user-dropdown"
          @click="toggleUserMenu"
        >
          <span class="nav-avatar-circle">
            <img v-if="avatarUrl" :src="avatarUrl" alt="头像" />
            <span v-else>{{ avatarInitial }}</span>
          </span>
          <span class="nav-uname">{{ nickname }}</span>
          <span class="nav-chevron" aria-hidden="true">▾</span>
        </button>
        <div id="mowo-user-dropdown" class="user-dropdown" :class="{ open: userMenuOpen }">
          <div class="dd-head">
            <div class="dd-av">
              <img v-if="avatarUrl" :src="avatarUrl" alt="头像" />
              <span v-else>{{ avatarInitial }}</span>
            </div>
            <div>
              <p class="dd-name">{{ nickname }}</p>
              <span
                class="dd-badge"
                :class="{ user: (session.user?.role ?? 0) < 2 }"
                :style="roleBadge.style"
              >
                {{ roleBadge.label }}
              </span>
            </div>
          </div>
          <RouterLink class="dd-item" to="/cart" @click="userMenuOpen = false">
            <span class="dd-item-icon" style="background: #fffbe6">🛒</span>购物车
          </RouterLink>
          <RouterLink class="dd-item" to="/orders" @click="userMenuOpen = false">
            <span class="dd-item-icon" style="background: #ebf5ff">📦</span>我的订单
          </RouterLink>
          <RouterLink class="dd-item" to="/account/customizations" @click="userMenuOpen = false">
            <span class="dd-item-icon" style="background: #fff3ee">✂</span>我的定制
          </RouterLink>
          <RouterLink class="dd-item" to="/account/animations" @click="userMenuOpen = false">
            <span class="dd-item-icon" style="background: #f0f4ff">🎬</span>我的动画
          </RouterLink>
          <RouterLink
            v-if="isStaff"
            class="dd-item admin-only"
            to="/admin/orders"
            @click="userMenuOpen = false"
          >
            <span class="dd-item-icon" style="background: #fff9c4">🛠</span>进入后台
          </RouterLink>
          <div class="dd-divider"></div>
          <RouterLink class="dd-item" to="/account/settings" @click="userMenuOpen = false">
            <span class="dd-item-icon" style="background: #ebebea">⚙️</span>账号设置
          </RouterLink>
          <RouterLink class="dd-item" to="/contact" @click="userMenuOpen = false">
            <span class="dd-item-icon" style="background: #ebebea">💬</span>帮助与反馈
          </RouterLink>
          <div class="dd-divider"></div>
          <button class="dd-item danger" type="button" @click="signOut">
            <span class="dd-item-icon" style="background: #fff5f5">🚪</span>退出登录
          </button>
        </div>
      </div>
      <button
        v-else
        class="mowo-nav-icon nav-login-btn"
        type="button"
        aria-label="登录 / 个人中心"
        @click="openAccount"
      >
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
        </svg>
      </button>
    </div>
  </nav>

  <div id="mowo-mobile-menu" class="mowo-mobile-menu" :class="{ open: menuOpen }">
    <div class="mowo-mobile-head">
      <RouterLink to="/" class="mowo-logo" @click="menuOpen = false">
        <span class="mowo-logo-mark">M</span><span class="mowo-logo-text">MOWOBOX</span>
      </RouterLink>
      <button class="mowo-mobile-close" type="button" aria-label="关闭" @click="menuOpen = false">
        <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </div>
    <div class="mowo-mobile-body">
      <RouterLink to="/about" @click="menuOpen = false">关于我们</RouterLink>
      <RouterLink to="/products" @click="menuOpen = false">动盒系列</RouterLink>
      <RouterLink to="/showcase" @click="menuOpen = false">联名作品</RouterLink>
      <RouterLink to="/customize">创作中心</RouterLink>
      <RouterLink to="/contact" @click="menuOpen = false">联络我们</RouterLink>
      <RouterLink to="/cart" @click="menuOpen = false">购物车</RouterLink>
      <RouterLink to="/orders" @click="menuOpen = false">我的订单</RouterLink>
      <RouterLink to="/account/settings" @click="menuOpen = false">账号设置</RouterLink>
    </div>
    <div class="mowo-mobile-foot">
      <button
        v-if="!session.isAuthenticated"
        id="mobileLoginBtn"
        type="button"
        @click="openAccount"
      >
        登录 / 注册
      </button>
      <RouterLink
        v-else
        class="mowo-mobile-avatar show"
        to="/account/settings"
        @click="menuOpen = false"
      >
        <span class="mowo-mobile-avatar-img">
          <img v-if="avatarUrl" :src="avatarUrl" alt="头像" />
          <span v-else>{{ avatarInitial }}</span>
        </span>
        <span class="mowo-mobile-avatar-name">{{ nickname }}</span>
      </RouterLink>
    </div>
  </div>
  <AuthDialog
    v-if="authOpen"
    :open="authOpen"
    :intro="authIntro"
    @close="authOpen = false"
    @authenticated="handleAuthenticated"
  />
</template>
