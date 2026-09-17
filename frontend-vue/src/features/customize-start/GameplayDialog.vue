<script setup lang="ts">
import { computed } from 'vue'
import type { MachineModel } from './types'

const props = defineProps<{ model: MachineModel | null }>()
const emit = defineEmits<{ close: []; select: []; details: [] }>()

const sizes = computed(() => [
  ...new Set(props.model?.skus.map((sku) => sku.size).filter(Boolean) ?? [])
])
const frames = computed(() =>
  [...new Set(props.model?.skus.map((sku) => sku.frameCount) ?? [])].sort((a, b) => a - b)
)
const materials = computed(() => [
  ...new Set(props.model?.skus.map((sku) => sku.material).filter(Boolean) ?? [])
])
</script>

<template>
  <div
    class="gameplay-overlay"
    :class="{ open: model }"
    :aria-hidden="!model"
    :inert="!model"
    @click.self="emit('close')"
  >
    <section
      class="gameplay-sheet"
      role="dialog"
      aria-modal="true"
      :aria-label="`${model?.name || ''}玩法`"
    >
      <div class="gameplay-handle"></div>
      <div class="gameplay-media">
        <video v-if="model?.videoUrl" :src="model.videoUrl" autoplay loop muted playsinline></video>
        <img v-else-if="model?.previewUrl" :src="model.previewUrl" :alt="model.name" />
        <div v-else class="gameplay-media-placeholder">🎡</div>
        <div class="gameplay-media-overlay">
          <span class="gameplay-media-name">{{ model?.name }}</span>
        </div>
        <button
          class="btn-gameplay-close"
          type="button"
          aria-label="关闭玩法"
          @click="emit('close')"
        >
          ✕
        </button>
      </div>
      <div class="gameplay-body">
        <p class="gameplay-desc">{{ model?.description || '暂无款式说明' }}</p>
        <div class="gameplay-specs-wrap">
          <div v-if="sizes.length" class="gameplay-spec-row">
            <span class="gameplay-spec-label">尺寸</span>
            <div class="gameplay-spec-chips">
              <span v-for="size in sizes" :key="size" class="gameplay-spec-chip">{{ size }}</span>
            </div>
          </div>
          <div v-if="frames.length" class="gameplay-spec-row">
            <span class="gameplay-spec-label">帧数</span>
            <div class="gameplay-spec-chips">
              <span v-for="frame in frames" :key="frame" class="gameplay-spec-chip"
                >{{ frame }} 帧</span
              >
            </div>
          </div>
          <div v-if="materials.length" class="gameplay-spec-row">
            <span class="gameplay-spec-label">材质</span>
            <div class="gameplay-spec-chips">
              <span v-for="material in materials" :key="material" class="gameplay-spec-chip">{{
                material
              }}</span>
            </div>
          </div>
        </div>
        <div class="gameplay-actions">
          <button class="btn-view-specs" type="button" @click="emit('details')">
            查看规格价格 →
          </button>
          <button class="btn-gameplay-select" type="button" @click="emit('select')">
            选择此款
          </button>
        </div>
      </div>
    </section>
  </div>
</template>
