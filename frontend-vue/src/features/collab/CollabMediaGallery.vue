<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CollabMedia } from './types'

const props = defineProps<{ media: CollabMedia[]; title: string }>()
const active = ref(0)
const failed = ref(new Set<number>())
const current = computed(() => props.media[active.value] ?? null)

watch(
  () => props.media,
  () => {
    active.value = 0
    failed.value = new Set()
  }
)

function markFailed(index: number): void {
  failed.value = new Set(failed.value).add(index)
}
</script>

<template>
  <section class="collab-gallery" aria-label="商品媒体">
    <div class="collab-gallery__stage">
      <div
        v-if="!current || failed.has(active)"
        class="media-fallback"
        role="img"
        :aria-label="`${title} 暂无可用预览`"
      >
        <span>MOWO</span>
        <small>媒体暂时无法显示</small>
      </div>
      <video
        v-else-if="current.kind === 'video'"
        :src="current.url"
        controls
        preload="metadata"
        @error="markFailed(active)"
      >
        当前浏览器无法播放该视频。
      </video>
      <img
        v-else
        :src="current.url"
        :alt="`${title} 预览 ${active + 1}`"
        @error="markFailed(active)"
      />
      <span v-if="media.length" class="collab-gallery__counter">
        {{ active + 1 }} / {{ media.length }}
      </span>
    </div>
    <div v-if="media.length > 1" class="collab-gallery__thumbs" aria-label="选择商品媒体">
      <button
        v-for="(item, index) in media"
        :key="`${item.url}-${index}`"
        type="button"
        :class="{ active: active === index }"
        :aria-label="`查看第 ${index + 1} 个媒体`"
        :aria-current="active === index ? 'true' : undefined"
        @click="active = index"
      >
        <span>{{ item.kind === 'video' ? '视频' : String(index + 1).padStart(2, '0') }}</span>
      </button>
    </div>
  </section>
</template>
