<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { CollabMedia } from './types'

type GallerySlide =
  | { type: 'image' | 'video'; url: string; label: string }
  | { type: 'player'; label: string }
  | { type: 'empty'; label: string }

const props = defineProps<{
  media: CollabMedia[]
  animationFrames: string[]
  title: string
}>()
const active = ref(0)
const failed = ref(new Set<number>())
const frameIndex = ref(0)
const playing = ref(false)
const fps = ref(10)
let frameTimer = 0

const slides = computed<GallerySlide[]>(() => {
  const seen = new Set<string>()
  const result: GallerySlide[] = []
  props.media.forEach((item) => {
    if (!item.url || seen.has(item.url)) return
    seen.add(item.url)
    result.push({ type: item.kind, url: item.url, label: '商品素材' })
  })
  if (props.animationFrames.length) result.push({ type: 'player', label: '动画预览' })
  return result.length ? result : [{ type: 'empty', label: '暂无素材' }]
})
const current = computed(() => slides.value[active.value] ?? slides.value[0])
const currentFrame = computed(() => props.animationFrames[frameIndex.value] ?? '')

function stopFrames(): void {
  window.clearInterval(frameTimer)
  playing.value = false
}
function startFrames(): void {
  if (!props.animationFrames.length) return
  stopFrames()
  playing.value = true
  frameTimer = window.setInterval(
    () => {
      frameIndex.value = (frameIndex.value + 1) % props.animationFrames.length
    },
    Math.round(1000 / fps.value)
  )
}
function toggleFrames(): void {
  if (playing.value) stopFrames()
  else startFrames()
}
function changeFps(delta: number): void {
  fps.value = Math.max(2, Math.min(20, fps.value + delta))
  if (playing.value) startFrames()
}
function goSlide(index: number): void {
  stopFrames()
  active.value = (index + slides.value.length) % slides.value.length
}
function markFailed(index: number): void {
  failed.value = new Set(failed.value).add(index)
}

watch([() => props.media, () => props.animationFrames], () => {
  stopFrames()
  active.value = 0
  frameIndex.value = 0
  failed.value = new Set()
})
onBeforeUnmount(stopFrames)
</script>

<template>
  <section class="gallery" aria-label="商品素材">
    <div class="stage">
      <div class="slide active">
        <strong v-if="failed.has(active)">该素材暂时不可用</strong>
        <video
          v-else-if="current?.type === 'video'"
          :src="current.url"
          controls
          playsinline
          preload="metadata"
          @error="markFailed(active)"
        >
          当前浏览器无法播放该视频。
        </video>
        <div v-else-if="current?.type === 'player'" class="frame-player">
          <img :src="currentFrame" alt="动画预览" @error="markFailed(active)" />
          <div class="player-tools">
            <span class="player-meta">{{ animationFrames.length }} 个核心帧 · {{ fps }} fps</span>
            <div>
              <button type="button" aria-label="减慢播放" @click="changeFps(-2)">-</button>
              <button type="button" aria-label="播放动画" @click="toggleFrames">
                {{ playing ? '暂停' : '播放' }}
              </button>
              <button type="button" aria-label="加快播放" @click="changeFps(2)">+</button>
            </div>
          </div>
        </div>
        <img
          v-else-if="current?.type === 'image'"
          :src="current.url"
          :alt="current.label"
          @error="markFailed(active)"
        />
        <strong v-else>暂无商品素材</strong>
      </div>
      <button
        v-if="slides.length > 1"
        class="gallery-arrow prev"
        type="button"
        aria-label="上一张"
        @click="goSlide(active - 1)"
      >
        ‹
      </button>
      <button
        v-if="slides.length > 1"
        class="gallery-arrow next"
        type="button"
        aria-label="下一张"
        @click="goSlide(active + 1)"
      >
        ›
      </button>
      <span class="counter">{{ active + 1 }} / {{ slides.length }}</span>
    </div>
    <div class="thumbs">
      <button
        v-for="(slide, index) in slides"
        :key="
          slide.type === 'image' || slide.type === 'video'
            ? `${slide.type}-${slide.url}`
            : slide.type
        "
        class="thumb"
        :class="{ active: active === index }"
        type="button"
        :aria-label="slide.label"
        @click="goSlide(index)"
      >
        <img v-if="slide.type === 'image'" :src="slide.url" alt="" />
        <span v-else>{{
          slide.type === 'video' ? '视频' : slide.type === 'player' ? '动画' : '暂无'
        }}</span>
      </button>
    </div>
  </section>
</template>
