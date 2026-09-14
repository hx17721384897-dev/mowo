<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { legacyPublicUrl } from '@/config/public-links'

const route = useRoute()
const menuOpen = ref(false)

watch(
  () => route.fullPath,
  () => {
    menuOpen.value = false
  }
)
</script>

<template>
  <header class="site-header">
    <div class="site-header__inner">
      <RouterLink class="site-brand" to="/" aria-label="哞屋首页">
        <span class="site-brand__mark" aria-hidden="true">M</span>
        <span><b>MOWO</b><small>哞屋造物</small></span>
      </RouterLink>

      <button
        class="menu-button"
        type="button"
        :aria-expanded="menuOpen"
        aria-controls="public-navigation"
        aria-label="打开或关闭导航"
        @click="menuOpen = !menuOpen"
      >
        <span /><span /><span />
      </button>

      <nav
        id="public-navigation"
        class="site-nav"
        :class="{ 'site-nav--open': menuOpen }"
        aria-label="主导航"
      >
        <RouterLink to="/">首页</RouterLink>
        <RouterLink to="/products">产品介绍</RouterLink>
        <a :href="legacyPublicUrl('showcase')">联名商品</a>
        <a :href="legacyPublicUrl('customize-start')">私人定制</a>
        <RouterLink to="/about">关于我们</RouterLink>
        <RouterLink to="/faq">常见问题</RouterLink>
        <a class="site-nav__contact" :href="legacyPublicUrl('contact')">联络我们</a>
      </nav>
    </div>
  </header>
</template>
