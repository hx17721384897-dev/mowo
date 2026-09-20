<script setup lang="ts">
withDefaults(
  defineProps<{
    reuse?: boolean
    activeStep?: number
    labels?: [string, string, string, string]
  }>(),
  { reuse: false, activeStep: 1 }
)
</script>

<template>
  <div class="progress-steps" aria-label="定制步骤">
    <div class="step-item" :class="{ active: activeStep === 1, done: activeStep > 1 }">
      <div class="step-num">1</div>
      <span class="step-label">{{ labels?.[0] || '选款式' }}</span>
    </div>
    <div class="step-divider"></div>
    <div class="step-item" :class="{ active: activeStep === 2, done: activeStep > 2 }">
      <div class="step-num">2</div>
      <span class="step-label">{{ labels?.[1] || (reuse ? '已有动画' : '上传 & 编辑') }}</span>
    </div>
    <div class="step-divider"></div>
    <div class="step-item" :class="{ active: activeStep === 3, done: activeStep > 3 }">
      <div class="step-num">3</div>
      <span class="step-label">{{ labels?.[2] || '选配置' }}</span>
    </div>
    <div class="step-divider"></div>
    <div class="step-item" :class="{ active: activeStep === 4, done: activeStep > 4 }">
      <div class="step-num">4</div>
      <span class="step-label">{{ labels?.[3] || '确认 & 购买' }}</span>
    </div>
  </div>
</template>
