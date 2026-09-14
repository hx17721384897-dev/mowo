<script setup lang="ts">
withDefaults(
  defineProps<{
    kind: 'loading' | 'empty' | 'error'
    title: string
    detail?: string
  }>(),
  { detail: '' }
)
</script>

<template>
  <section class="app-state" :data-kind="kind" role="status" aria-live="polite">
    <span class="app-state__mark" aria-hidden="true">{{ kind === 'loading' ? '…' : '○' }}</span>
    <h2>{{ title }}</h2>
    <p v-if="detail">{{ detail }}</p>
    <slot />
  </section>
</template>
