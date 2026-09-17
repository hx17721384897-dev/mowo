<script setup lang="ts">
defineProps<{ reuse: boolean }>()
</script>

<template>
  <div class="progress-steps" aria-label="定制步骤">
    <div class="step-item active">
      <div class="step-num">1</div>
      <span class="step-label">选款式</span>
    </div>
    <div class="step-divider"></div>
    <div class="step-item">
      <div class="step-num">2</div>
      <span class="step-label">{{ reuse ? '已有动画' : '上传 & 编辑' }}</span>
    </div>
    <div class="step-divider"></div>
    <div class="step-item">
      <div class="step-num">3</div>
      <span class="step-label">选配置</span>
    </div>
    <div class="step-divider"></div>
    <div class="step-item">
      <div class="step-num">4</div>
      <span class="step-label">确认 & 购买</span>
    </div>
  </div>
</template>
