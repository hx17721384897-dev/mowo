<script setup lang="ts">
import type { OrderViewModel } from './types'
import { ORDER_STEPS, orderProgressWidth } from './order-presentation'

defineProps<{ order: OrderViewModel; hero?: boolean }>()
</script>

<template>
  <div class="order-progress" :class="{ 'order-progress--hero': hero }">
    <div class="progress-steps">
      <div class="progress-line"></div>
      <div class="progress-line-fill" :style="{ width: orderProgressWidth(order) }"></div>
      <div v-for="(label, index) in ORDER_STEPS" :key="label" class="p-step">
        <div
          class="p-dot"
          :class="{ done: index < order.statusStep, current: index === order.statusStep }"
        >
          <span v-if="index === order.statusStep" class="p-dot-inner"></span>
        </div>
        <span class="p-label" :class="{ 'active-label': index === order.statusStep }">{{
          label
        }}</span>
      </div>
    </div>
  </div>
</template>
