<script setup lang="ts">
defineProps<{
  area: string
  title: string
  description: string
}>()
</script>

<template>
  <div class="app-shell">
    <header class="app-shell__header">
      <RouterLink class="brand" to="/">MOWO <span>哞屋</span></RouterLink>
      <span class="area-badge">{{ area }}</span>
    </header>
    <main class="app-shell__main">
      <div class="page-heading">
        <p class="eyebrow">V0 FOUNDATION</p>
        <h1>{{ title }}</h1>
        <p>{{ description }}</p>
      </div>
      <RouterView />
    </main>
  </div>
</template>
