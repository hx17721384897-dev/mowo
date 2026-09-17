<script setup lang="ts">
import { computed } from 'vue'
import type { MachineModel } from './types'

const props = defineProps<{ model: MachineModel; selected: boolean }>()
const emit = defineEmits<{ select: []; gameplay: [] }>()

const sizes = computed(() => [...new Set(props.model.skus.map((sku) => sku.size).filter(Boolean))])
const minPrice = computed(() => {
  const prices = props.model.skus.map((sku) => sku.price).filter((price) => price > 0)
  return prices.length ? Math.min(...prices) : null
})
</script>

<template>
  <article
    class="model-card"
    :class="{ selected }"
    :aria-label="model.name"
    @click="emit('select')"
  >
    <div class="model-card-visual">
      <img v-if="model.previewUrl" :src="model.previewUrl" :alt="model.name" loading="lazy" />
      <video
        v-else-if="model.videoUrl"
        :src="model.videoUrl"
        autoplay
        loop
        muted
        playsinline
      ></video>
      <div v-else class="mock-wrap">
        <div class="mock-cylinder"><div class="mock-ring"></div></div>
      </div>
      <div class="card-check">✓</div>
    </div>
    <div class="model-card-body">
      <div class="model-name-row">
        <span class="model-card-name">{{ model.name }}</span>
      </div>
      <p class="model-card-desc">{{ model.description }}</p>
      <div v-if="sizes.length" class="model-card-sizes">
        <span class="size-chip">画面尺寸：{{ sizes.join(' / ') }}</span>
      </div>
      <div class="model-card-foot">
        <div class="model-price-wrap">
          <template v-if="minPrice !== null">
            <span class="model-price">¥{{ minPrice }}</span
            ><span class="model-price-unit"> 起</span>
          </template>
          <span v-else class="model-price-na">—</span>
        </div>
        <div class="model-card-btns">
          <button class="btn-gameplay" type="button" @click.stop="emit('gameplay')">
            查看玩法
          </button>
          <button
            class="btn-select-card"
            :class="{ selected }"
            type="button"
            @click.stop="emit('select')"
          >
            选择此款
          </button>
        </div>
      </div>
    </div>
  </article>
</template>
