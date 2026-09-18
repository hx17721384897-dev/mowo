<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{
  files: readonly File[]
  title: string
  subtitle: string
  icon: string
  accessibleLabel: string
}>()
const emit = defineEmits<{
  select: [files: File[]]
  clear: []
}>()
const dragging = ref(false)
const input = ref<HTMLInputElement | null>(null)
const totalBytes = computed(() => props.files.reduce((sum, file) => sum + file.size, 0))
const displayName = computed(() =>
  props.files.length === 1 ? props.files[0]!.name : `${props.files.length} 张原始图片`
)
const displayMeta = computed(() => {
  const formats = [...new Set(props.files.map((file) => file.type || '未知格式'))]
  return `${formatBytes(totalBytes.value)} · ${formats.join(' / ')}`
})

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function select(files: FileList | null): void {
  if (files) emit('select', Array.from(files))
  if (input.value) input.value.value = ''
}

function drop(event: DragEvent): void {
  event.preventDefault()
  dragging.value = false
  select(event.dataTransfer?.files ?? null)
}
</script>

<template>
  <div
    v-if="!files.length"
    class="drop-zone"
    :class="{ dragover: dragging }"
    @dragover.prevent="dragging = true"
    @dragleave="dragging = false"
    @drop="drop"
  >
    <input
      ref="input"
      class="drop-input"
      type="file"
      accept=".mp4,.webm,.mov,.png,.jpg,.jpeg,.webp"
      multiple
      :aria-label="accessibleLabel"
      @change="select(($event.target as HTMLInputElement).files)"
    />
    <div class="drop-icon">{{ icon }}</div>
    <p class="drop-title">{{ title }}</p>
    <p class="drop-sub">{{ subtitle }}</p>
    <div class="drop-formats" aria-hidden="true">
      <span class="fmt-tag fmt-video">MP4 / WebM / MOV</span>
      <span class="fmt-tag fmt-img">JPG / PNG / WEBP</span>
    </div>
  </div>
  <div v-else class="file-preview">
    <span class="file-preview-icon">📁</span>
    <div class="file-preview-info">
      <p class="file-preview-name">{{ displayName }}</p>
      <p class="file-preview-meta">{{ displayMeta }}</p>
    </div>
    <button class="file-preview-remove" type="button" title="移除素材" @click="emit('clear')">
      ✕
    </button>
  </div>
</template>
