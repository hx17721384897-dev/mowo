<script setup lang="ts">
defineProps<{ label: string }>()
</script>

<template>
  <section class="placeholder-card">
    <p>{{ label }}</p>
    <span>V0 只建立边界，不迁移业务。</span>
  </section>
</template>
