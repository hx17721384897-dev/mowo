<template>
  <div class="account-shell">
    <a class="skip-link" href="#account-main">跳到主要内容</a>
    <PublicHeader />
    <main id="account-main"><RouterView /></main>
  </div>
</template>

<script setup lang="ts">
import PublicHeader from '@/components/PublicHeader.vue'
</script>

<style scoped>
.account-shell {
  min-height: 100vh;
  background: #f5f3ef;
}
</style>
