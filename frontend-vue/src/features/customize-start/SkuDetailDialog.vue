<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { MachineModel } from './types'

const props = defineProps<{ model: MachineModel | null; sales: Record<string, number> }>()
const emit = defineEmits<{ close: [] }>()

const size = ref('')
const material = ref('')
const frame = ref('')
const color = ref('')
const priceSort = ref<'' | 'asc' | 'desc'>('')
const popularSort = ref(false)

watch(
  () => props.model?.id,
  () => {
    size.value = ''
    material.value = ''
    frame.value = ''
    color.value = ''
    priceSort.value = ''
    popularSort.value = false
  }
)

const sizes = computed(() => [...new Set(props.model?.skus.map((sku) => sku.size) ?? [])])
const materials = computed(() => [...new Set(props.model?.skus.map((sku) => sku.material) ?? [])])
const frames = computed(() =>
  [...new Set(props.model?.skus.map((sku) => sku.frameCount) ?? [])].sort((a, b) => a - b)
)
const colors = computed(() => [...new Set(props.model?.skus.map((sku) => sku.colorName) ?? [])])
const filtered = computed(() => {
  let list = (props.model?.skus ?? []).filter((sku) => {
    if (size.value && sku.size !== size.value) return false
    if (material.value && sku.material !== material.value) return false
    if (frame.value && String(sku.frameCount) !== frame.value) return false
    if (color.value && sku.colorName !== color.value) return false
    return true
  })
  if (popularSort.value)
    list = [...list].sort((a, b) => (props.sales[b.id] ?? 0) - (props.sales[a.id] ?? 0))
  else if (priceSort.value === 'asc') list = [...list].sort((a, b) => a.price - b.price)
  else if (priceSort.value === 'desc') list = [...list].sort((a, b) => b.price - a.price)
  return list
})
const popularIds = computed(
  () =>
    new Set(
      [...filtered.value]
        .sort((a, b) => (props.sales[b.id] ?? 0) - (props.sales[a.id] ?? 0))
        .slice(0, 3)
        .filter((sku) => (props.sales[sku.id] ?? 0) > 0)
        .map((sku) => sku.id)
    )
)

function togglePrice(): void {
  popularSort.value = false
  priceSort.value = priceSort.value === '' ? 'asc' : priceSort.value === 'asc' ? 'desc' : ''
}

function togglePopular(): void {
  popularSort.value = !popularSort.value
  if (popularSort.value) priceSort.value = ''
}

function chooseSize(value: string): void {
  size.value = value
  popularSort.value = false
}

function chooseMaterial(value: string): void {
  material.value = value
  popularSort.value = false
}

function chooseFrame(value: number): void {
  frame.value = String(value)
  popularSort.value = false
}

function chooseColor(value: string): void {
  color.value = value
  popularSort.value = false
}
</script>

<template>
  <div
    class="detail-overlay"
    :class="{ open: model }"
    :aria-hidden="!model"
    :inert="!model"
    @click.self="emit('close')"
  >
    <section
      class="detail-sheet"
      role="dialog"
      aria-modal="true"
      :aria-label="`${model?.name || ''}规格与价格`"
    >
      <div class="detail-handle"></div>
      <div class="detail-video-wrap">
        <video v-if="model?.videoUrl" :src="model.videoUrl" autoplay loop muted playsinline></video>
        <img v-else-if="model?.previewUrl" :src="model.previewUrl" :alt="model.name" />
        <div v-else class="detail-video-placeholder">
          <div class="detail-video-ph-icon">🎬</div>
          <div class="detail-video-ph-text">暂无介绍视频</div>
        </div>
        <div class="detail-video-bar">
          <div class="detail-video-name">{{ model?.name }}</div>
          <RouterLink class="btn-to-showcase" to="/showcase">🎨 案例展示</RouterLink>
        </div>
        <button class="btn-detail-close" type="button" aria-label="关闭规格" @click="emit('close')">
          ✕
        </button>
      </div>
      <div class="detail-head">
        <div class="detail-head-title">{{ model?.name }} · 规格 & 价格</div>
        <div class="detail-head-sub">可通过下方筛选快速定位心仪规格</div>
      </div>
      <div class="detail-filter-wrap">
        <div v-if="sizes.length" class="filter-row">
          <span class="filter-row-label">尺寸</span>
          <button class="filter-chip" :class="{ active: !size }" type="button" @click="size = ''">
            全部
          </button>
          <button
            v-for="value in sizes"
            :key="value"
            class="filter-chip"
            :class="{ active: size === value }"
            type="button"
            @click="chooseSize(value)"
          >
            {{ value }}
          </button>
        </div>
        <div v-if="materials.length" class="filter-row">
          <span class="filter-row-label">材质</span>
          <button
            class="filter-chip"
            :class="{ active: !material }"
            type="button"
            @click="material = ''"
          >
            全部
          </button>
          <button
            v-for="value in materials"
            :key="value"
            class="filter-chip"
            :class="{ active: material === value }"
            type="button"
            @click="chooseMaterial(value)"
          >
            {{ value }}
          </button>
        </div>
        <div v-if="frames.length" class="filter-row">
          <span class="filter-row-label">帧数</span>
          <button class="filter-chip" :class="{ active: !frame }" type="button" @click="frame = ''">
            全部
          </button>
          <button
            v-for="value in frames"
            :key="value"
            class="filter-chip"
            :class="{ active: frame === String(value) }"
            type="button"
            @click="chooseFrame(value)"
          >
            {{ value }}帧
          </button>
        </div>
        <div v-if="colors.length" class="filter-row">
          <span class="filter-row-label">颜色</span>
          <button class="filter-chip" :class="{ active: !color }" type="button" @click="color = ''">
            全部
          </button>
          <button
            v-for="value in colors"
            :key="value"
            class="filter-chip"
            :class="{ active: color === value }"
            type="button"
            @click="chooseColor(value)"
          >
            {{ value }}
          </button>
        </div>
        <div class="filter-row">
          <span class="filter-row-label">排序</span>
          <button
            class="filter-chip"
            :class="{ active: popularSort }"
            type="button"
            @click="togglePopular"
          >
            🔥 热门
          </button>
          <button
            class="filter-chip"
            :class="[{ active: priceSort }, priceSort ? `sort-${priceSort}` : '']"
            type="button"
            @click="togglePrice"
          >
            价格
          </button>
        </div>
      </div>
      <div class="detail-sku-wrap">
        <div v-if="filtered.length" class="sku-grid">
          <article
            v-for="sku in filtered"
            :key="sku.id"
            class="sku-card"
            :class="{ popular: popularIds.has(sku.id) }"
          >
            <div class="sku-card-img">
              <div v-if="popularIds.has(sku.id)" class="popular-badge">🔥 热门</div>
              <img v-if="sku.previewUrl" :src="sku.previewUrl" alt="" loading="lazy" />
              <span v-else>📦</span>
            </div>
            <div class="sku-card-body">
              <div class="sku-card-name">{{ sku.size }} · {{ sku.material }}</div>
              <div class="sku-card-spec">{{ sku.frameCount }} 帧 · {{ sku.colorName }}</div>
              <div class="sku-card-foot">
                <div class="sku-card-price">¥{{ sku.price.toFixed(0) }}<span> 元</span></div>
                <div
                  class="sku-color-dot"
                  :style="{ background: sku.colorHex }"
                  :title="sku.colorName"
                ></div>
              </div>
            </div>
          </article>
        </div>
        <div v-else class="sku-empty-state">没有符合条件的规格</div>
      </div>
    </section>
  </div>
</template>
