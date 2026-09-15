<script setup lang="ts">
import { useRoute } from 'vue-router'
import PublicFooter from '@/components/PublicFooter.vue'
import PublicHeader from '@/components/PublicHeader.vue'

const route = useRoute()
</script>

<template>
  <div class="public-shell">
    <a class="skip-link" href="#main-content">跳到主要内容</a>
    <PublicHeader v-if="!route.meta.pageOwnHeader" />
    <div id="main-content"><RouterView /></div>
    <PublicFooter v-if="!route.meta.pageOwnFooter" />
  </div>
</template>
