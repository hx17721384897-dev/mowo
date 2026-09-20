<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { validateTrimWindow } from './source-validation'

const props = defineProps<{ source: string; duration: number }>()
const emit = defineEmits<{ confirm: [start: number, end: number]; cancel: [] }>()
const start = ref(0)
const end = ref(Math.min(props.duration, 8))
const video = ref<HTMLVideoElement | null>(null)
const playing = ref(false)
const selectedDuration = computed(() => Math.max(0, end.value - start.value))
const valid = computed(() => selectedDuration.value >= 0.5 && selectedDuration.value <= 8)
const left = computed(() => `${(start.value / props.duration) * 100}%`)
const right = computed(() => `${100 - (end.value / props.duration) * 100}%`)

function normalize(changed: 'start' | 'end'): void {
  if (changed === 'start' && start.value > end.value - 0.5)
    start.value = Math.max(0, end.value - 0.5)
  if (changed === 'end' && end.value < start.value + 0.5)
    end.value = Math.min(props.duration, start.value + 0.5)
  if (video.value) video.value.currentTime = changed === 'start' ? start.value : end.value
}

function togglePlay(): void {
  const element = video.value
  if (!element) return
  if (playing.value) {
    element.pause()
    playing.value = false
    return
  }
  if (element.currentTime < start.value || element.currentTime >= end.value)
    element.currentTime = start.value
  void element.play()
  playing.value = true
}

function timeUpdate(): void {
  const element = video.value
  if (!element || element.currentTime < end.value) return
  element.pause()
  element.currentTime = start.value
  playing.value = false
}

function confirm(): void {
  validateTrimWindow(start.value, end.value, props.duration)
  emit('confirm', start.value, end.value)
}

onBeforeUnmount(() => video.value?.pause())
</script>

<template>
  <main id="stateTrim" class="active">
    <div class="trim-wrap">
      <div>
        <p class="trim-title">裁剪视频片段</p>
        <p class="trim-sub">
          拖动两端手柄选取你想要的片段（最长 8 秒），系统会自动提取该区间的帧。
        </p>
      </div>
      <div class="trim-video-wrap">
        <video
          ref="video"
          :src="source"
          playsinline
          preload="metadata"
          @timeupdate="timeUpdate"
          @pause="playing = false"
        ></video>
      </div>
      <div class="trim-play-row">
        <button class="trim-play-btn" type="button" aria-label="预览选取区间" @click="togglePlay">
          {{ playing ? 'Ⅱ' : '▶' }}
        </button>
        <p class="trim-play-hint">
          预览选取区间 · 播完自动暂停<br />拖动手柄时视频同步预览对应画面
        </p>
      </div>
      <div class="trim-info-row">
        <span class="trim-duration-badge" :class="{ err: !valid }"
          >已选 {{ selectedDuration.toFixed(1) }} 秒</span
        >
        <span class="trim-est"
          >提取后约 {{ Math.round(selectedDuration * 30) }} 帧，去重后更少</span
        >
      </div>
      <div class="trim-timeline-wrap">
        <span class="trim-timeline-label">选取区间</span>
        <div class="trim-range-stack">
          <div class="trim-range-track">
            <div class="trim-mask-left" :style="{ width: left }"></div>
            <div class="trim-mask-right" :style="{ width: right }"></div>
            <div class="trim-selection" :style="{ left, right }"></div>
          </div>
          <input
            v-model.number="start"
            class="trim-range"
            type="range"
            min="0"
            :max="duration"
            step="0.01"
            aria-label="片段开始时间"
            @input="normalize('start')"
          />
          <input
            v-model.number="end"
            class="trim-range"
            type="range"
            min="0"
            :max="duration"
            step="0.01"
            aria-label="片段结束时间"
            @input="normalize('end')"
          />
        </div>
        <div class="trim-time-row">
          <span class="trim-time-val">{{ start.toFixed(1) }}s</span
          ><span class="trim-time-sep">→</span
          ><span class="trim-time-val">{{ end.toFixed(1) }}s</span>
        </div>
      </div>
      <div class="trim-actions">
        <button class="btn btn-secondary btn-sm" type="button" @click="emit('cancel')">
          ← 重新上传
        </button>
        <button class="btn btn-yellow btn-sm" type="button" :disabled="!valid" @click="confirm">
          提取帧 →
        </button>
      </div>
    </div>
  </main>
</template>
