<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  applyDuplicateFrameIds,
  cloneCurrent,
  createEditorState,
  deselectCurrent,
  matchingFrameTargets,
  sampleSelectedEvery,
  selectedFrames,
  setAllSelected,
  setCursor,
  toggleFrame,
  undoEditor
} from './editor-core'
import { averageHash, hammingDistance } from './media-processing'
import type { EditorState } from './types'
import { useSessionStore } from '@/stores/session'

const props = defineProps<{
  frames: Array<{ source: string; selected: boolean }>
  targets: number[]
  busy: boolean
  progress: string
}>()
const emit = defineEmits<{ next: [sources: string[], indexes: number[]]; reupload: [] }>()
const session = useSessionStore()
const state = ref<EditorState>(createEditorState(props.frames))
const speed = ref(4)
const playing = ref(false)
const filterSelected = ref(false)
const sample = ref(2)
const dedupLevel = ref<'low' | 'mid' | 'high'>('mid')
const dedupBusy = ref(false)
const selectMode = ref(false)
let timer = 0
let longPressTimer = 0
let suppressNextClick = false

const selected = computed(() => selectedFrames(state.value))
const cursor = computed(
  () =>
    state.value.frames.find((frame) => frame.id === state.value.cursorId) ??
    selected.value[0] ??
    null
)
const cursorPosition = computed(() =>
  Math.max(
    0,
    selected.value.findIndex((frame) => frame.id === cursor.value?.id)
  )
)
const validTargets = computed(() => matchingFrameTargets(selected.value.length, props.targets))
const visibleFrames = computed(() =>
  filterSelected.value ? state.value.frames.filter((frame) => frame.selected) : state.value.frames
)
const watermarkId = computed(() => session.user?.id.slice(-8).toUpperCase() ?? '')

function stop(): void {
  playing.value = false
  window.clearTimeout(timer)
}
function chooseAt(index: number): void {
  stop()
  const list = selected.value
  if (!list.length) return
  const normalized = (index + list.length) % list.length
  state.value = setCursor(state.value, list[normalized]!.id)
}
function tick(): void {
  if (!playing.value) return
  chooseAt(cursorPosition.value + 1)
  playing.value = true
  timer = window.setTimeout(tick, Math.round(500 - (speed.value - 1) * 50))
}
function togglePlay(): void {
  if (playing.value) stop()
  else {
    playing.value = true
    timer = window.setTimeout(tick, Math.round(500 - (speed.value - 1) * 50))
  }
}
function toggle(id: string): void {
  stop()
  state.value = toggleFrame(state.value, id)
}
function originalPosition(id: string): number {
  return state.value.frames.findIndex((frame) => frame.id === id) + 1
}
function next(): void {
  if (!validTargets.value.length) return
  const selectedIds = new Set(selected.value.map((frame) => frame.id))
  emit(
    'next',
    selected.value.map((frame) => frame.source),
    state.value.frames
      .map((frame, index) => (selectedIds.has(frame.id) ? index : -1))
      .filter((index) => index >= 0)
  )
}

async function imageHash(source: string): Promise<Uint8Array> {
  const image = new Image()
  image.src = source
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 8
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('当前浏览器无法执行智能去重')
  context.drawImage(image, 0, 0, 8, 8)
  return averageHash(context.getImageData(0, 0, 8, 8).data)
}

async function deduplicate(): Promise<void> {
  if (selected.value.length < 2 || dedupBusy.value) return
  dedupBusy.value = true
  try {
    const hashes = await Promise.all(selected.value.map((frame) => imageHash(frame.source)))
    const threshold = { low: 3, mid: 6, high: 10 }[dedupLevel.value]
    const duplicateIds = selected.value
      .filter(
        (_, index) => index > 0 && hammingDistance(hashes[index]!, hashes[index - 1]!) <= threshold
      )
      .map((frame) => frame.id)
    state.value = applyDuplicateFrameIds(state.value, duplicateIds)
  } finally {
    dedupBusy.value = false
  }
}

function frameClick(frameId: string): void {
  if (suppressNextClick) {
    suppressNextClick = false
    return
  }
  if (window.innerWidth < 768 && selectMode.value) toggle(frameId)
  else state.value = setCursor(state.value, frameId)
}
function startLongPress(frameId: string): void {
  if (window.innerWidth >= 768 || selectMode.value) return
  longPressTimer = window.setTimeout(() => {
    suppressNextClick = true
    selectMode.value = true
    navigator.vibrate?.(30)
    toggle(frameId)
  }, 300)
}
function cancelLongPress(): void {
  window.clearTimeout(longPressTimer)
}

function keyboard(event: KeyboardEvent): void {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
    return
  if (event.key === ' ') {
    event.preventDefault()
    togglePlay()
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    chooseAt(cursorPosition.value - 1)
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    chooseAt(cursorPosition.value + 1)
  } else if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    state.value = deselectCurrent(state.value)
  } else if (event.key.toLowerCase() === 'z' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    state.value = undoEditor(state.value)
  }
}

watch(speed, () => {
  if (playing.value) {
    stop()
    togglePlay()
  }
})
onMounted(() => window.addEventListener('keydown', keyboard))
onBeforeUnmount(() => {
  stop()
  cancelLongPress()
  window.removeEventListener('keydown', keyboard)
})
</script>

<template>
  <main id="stateEditor" class="active">
    <div class="editor-left">
      <div class="preview-panel">
        <div class="preview-header">
          <span class="preview-title">动画预览</span
          ><span class="preview-sub">{{
            selected.length ? `第 ${cursorPosition + 1} 帧 / 共 ${selected.length} 帧` : '—'
          }}</span>
        </div>
        <div class="preview-canvas-wrap">
          <img v-if="cursor" class="preview-img" :src="cursor.source" alt="当前动画帧" />
          <template v-if="cursor">
            <span class="preview-brand">MOWOBOX</span>
            <span v-if="watermarkId" class="preview-user-mark">{{ watermarkId }}</span>
          </template>
          <div v-else class="preview-empty">
            <span class="preview-empty-icon">🎞</span
            ><span class="preview-empty-text">暂无勾选帧</span>
          </div>
        </div>
      </div>
      <div class="control-panel">
        <div class="ctrl-section">
          <span class="ctrl-label">播放控制</span>
          <div class="speed-row">
            <span class="speed-label">速度</span
            ><input
              v-model.number="speed"
              class="speed-slider"
              type="range"
              min="1"
              max="10"
            /><span class="speed-val">{{ speed }}x</span>
          </div>
          <div class="playback-row">
            <button class="ctl-btn" type="button" title="第一帧" @click="chooseAt(0)">⏮</button
            ><button
              class="ctl-btn"
              type="button"
              title="上一帧"
              @click="chooseAt(cursorPosition - 1)"
            >
              ◀</button
            ><button class="ctl-btn ctl-play" type="button" title="播放/暂停" @click="togglePlay">
              {{ playing ? '⏸' : '▶' }}</button
            ><button
              class="ctl-btn"
              type="button"
              title="下一帧"
              @click="chooseAt(cursorPosition + 1)"
            >
              ▶▌</button
            ><button
              class="ctl-btn"
              type="button"
              title="最后帧"
              @click="chooseAt(selected.length - 1)"
            >
              ⏭
            </button>
          </div>
        </div>
        <div class="ctrl-section">
          <span class="ctrl-label">编辑当前帧</span>
          <div class="edit-row">
            <button class="edit-btn btn-clone" type="button" @click="state = cloneCurrent(state)">
              ⧉ 克隆此帧</button
            ><button class="edit-btn btn-del" type="button" @click="state = deselectCurrent(state)">
              🗑 删除此帧</button
            ><button
              class="edit-btn btn-undo"
              type="button"
              :disabled="!state.undo.length"
              @click="state = undoEditor(state)"
            >
              ↩ 撤销
            </button>
          </div>
        </div>
        <div class="ctrl-section">
          <div class="tool-card">
            <div class="tool-head">
              <span class="tool-name">🔍 智能去重</span><span class="tool-badge">感知哈希</span>
            </div>
            <p class="tool-desc">
              用感知哈希找出相似帧并取消勾选。停顿帧不会被删除，可手动重新勾选。
            </p>
            <div class="seg-btns">
              <button
                v-for="level in [
                  ['low', '轻度'],
                  ['mid', '中度'],
                  ['high', '强度']
                ] as const"
                :key="level[0]"
                class="seg-btn"
                :class="{ on: dedupLevel === level[0] }"
                type="button"
                @click="dedupLevel = level[0]"
              >
                {{ level[1] }}
              </button>
            </div>
            <button class="tool-apply" type="button" :disabled="dedupBusy" @click="deduplicate">
              {{ dedupBusy ? '分析中…' : '执行去重' }}
            </button>
          </div>
        </div>
        <div class="ctrl-section">
          <div class="tool-card">
            <div class="tool-head"><span class="tool-name">⚡ 快速抽帧</span></div>
            <p class="tool-desc">按间隔取消中间帧，快速缩减帧数。</p>
            <div class="seg-btns">
              <button
                v-for="value in [2, 3, 4, 5]"
                :key="value"
                class="seg-btn"
                :class="{ on: sample === value }"
                type="button"
                @click="sample = value"
              >
                每{{ value }}帧
              </button>
            </div>
            <button
              class="tool-apply"
              type="button"
              @click="state = sampleSelectedEvery(state, sample)"
            >
              执行抽帧
            </button>
          </div>
        </div>
      </div>
    </div>
    <div class="editor-right">
      <div class="thumb-panel" :class="{ 'select-mode': selectMode }">
        <div class="thumb-bar">
          <div class="thumb-bar-left">
            <span class="thumb-count-txt"
              >已选 <strong>{{ selected.length }}</strong> 帧
              <span>/ 共 {{ state.frames.length }} 帧</span></span
            >
            <div class="thumb-bar-desktop">
              <button class="mini-btn" type="button" @click="state = setAllSelected(state, true)">
                全选</button
              ><button class="mini-btn" type="button" @click="state = setAllSelected(state, false)">
                全不选</button
              ><button
                class="mini-btn-filter"
                :class="{ active: filterSelected }"
                type="button"
                @click="filterSelected = !filterSelected"
              >
                仅看已选
              </button>
            </div>
            <div class="thumb-bar-mobile" :class="{ hidden: selectMode }">
              <button class="btn-select-mode" type="button" @click="selectMode = true">
                ☑ 勾选
              </button>
              <button
                class="mini-btn-filter"
                :class="{ active: filterSelected }"
                type="button"
                @click="filterSelected = !filterSelected"
              >
                仅看已选
              </button>
            </div>
            <div class="thumb-bar-mobile" :class="{ hidden: !selectMode }">
              <button class="mini-btn" type="button" @click="state = setAllSelected(state, true)">
                全选
              </button>
              <button class="mini-btn" type="button" @click="state = setAllSelected(state, false)">
                全不选
              </button>
              <button class="btn-select-done" type="button" @click="selectMode = false">
                完成 ✓
              </button>
            </div>
          </div>
          <div class="thumb-status">
            <span class="frame-badge" :class="validTargets.length ? 'badge-ok' : 'badge-err'"
              >{{ selected.length }} 帧</span
            ><span class="frame-hint">目标：{{ targets.join(' / ') }} 帧</span>
          </div>
        </div>
        <div class="thumb-scroll">
          <div class="thumb-grid">
            <div
              v-for="frame in visibleFrames"
              :key="frame.id"
              class="thumb-item"
              :class="{ 'is-active': frame.id === cursor?.id, 'is-off': !frame.selected }"
              @click="frameClick(frame.id)"
              @pointerdown="startLongPress(frame.id)"
              @pointerup="cancelLongPress"
              @pointerleave="cancelLongPress"
            >
              <img class="thumb-img" :src="frame.source" alt="" draggable="false" /><span
                class="thumb-num"
                >{{ originalPosition(frame.id) }}</span
              ><button
                class="thumb-check"
                type="button"
                :aria-label="`${frame.selected ? '取消' : '选择'}第 ${originalPosition(frame.id)} 帧`"
                @click.stop="toggle(frame.id)"
              >
                <span class="thumb-tick">✓</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      <div class="editor-bar">
        <div class="ebar-l">
          <div class="ebar-stat">
            <span class="ebar-stat-lbl">当前已选</span
            ><span class="ebar-stat-val">{{ selected.length }} 帧</span>
          </div>
          <div class="ebar-sep"></div>
          <div>
            <div class="ebar-stat-lbl ebar-target-label">可用款式帧数</div>
            <div class="ebar-targets">
              <span
                v-for="target in targets"
                :key="target"
                class="ebar-tgt"
                :class="{ hit: validTargets.includes(target) }"
                >{{ target }} 帧</span
              >
            </div>
          </div>
        </div>
        <div class="ebar-r">
          <button class="ebar-back-btn" type="button" @click="emit('reupload')">← 重新上传</button
          ><button
            class="btn btn-yellow btn-sm"
            type="button"
            :disabled="!validTargets.length || busy"
            @click="next"
          >
            {{ progress || '下一步 →' }}
          </button>
        </div>
      </div>
    </div>
  </main>
</template>
