<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { legacyPublicUrl } from '@/config/public-links'
import AuthDialog from '@/features/auth/AuthDialog.vue'

const route = useRoute()
const menuOpen = ref(false)
const authOpen = ref(false)

watch(
  () => route.fullPath,
  () => {
    menuOpen.value = false
  }
)

watch(menuOpen, (open) => {
  document.body.style.overflow = open ? 'hidden' : ''
})

onBeforeUnmount(() => {
  document.body.style.overflow = ''
})

function openAuth(): void {
  menuOpen.value = false
  authOpen.value = true
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
      <a :href="legacyPublicUrl('customize-start')">创作中心</a>
      <RouterLink to="/contact" @click="menuOpen = false">联络我们</RouterLink>
    </div>
    <div class="mowo-nav-right">
      <RouterLink class="mowo-nav-icon" to="/showcase" aria-label="搜索">
        <svg viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </RouterLink>
      <a
        class="mowo-nav-icon mowo-cart-btn"
        :href="legacyPublicUrl('cart')"
        data-count="0"
        aria-label="购物车"
      >
        <svg viewBox="0 0 24 24">
          <path d="M3 4h2l2.5 12h11l2.5-9H6" />
          <circle cx="9" cy="20" r="1.6" />
          <circle cx="18" cy="20" r="1.6" />
        </svg>
      </a>
      <button
        class="mowo-nav-icon nav-login-btn"
        type="button"
        aria-label="登录 / 个人中心"
        @click="openAuth"
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
      <a :href="legacyPublicUrl('customize-start')">创作中心</a>
      <RouterLink to="/contact" @click="menuOpen = false">联络我们</RouterLink>
      <a :href="legacyPublicUrl('cart')">购物车</a>
      <a :href="legacyPublicUrl('orders')">我的订单</a>
      <a :href="legacyPublicUrl('settings')">账号设置</a>
    </div>
    <div class="mowo-mobile-foot"><button type="button" @click="openAuth">登录 / 注册</button></div>
  </div>
  <AuthDialog
    v-if="authOpen"
    :open="authOpen"
    @close="authOpen = false"
    @authenticated="authOpen = false"
  />
</template>
