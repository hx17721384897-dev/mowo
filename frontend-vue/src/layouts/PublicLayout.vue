<script setup lang="ts">
import PublicFooter from '@/components/PublicFooter.vue'
import PublicHeader from '@/components/PublicHeader.vue'
</script>

<template>
  <div class="public-shell">
    <a class="skip-link" href="#main-content">跳到主要内容</a>
    <PublicHeader />
    <div id="main-content"><RouterView /></div>
    <PublicFooter />
  </div>
</template>
