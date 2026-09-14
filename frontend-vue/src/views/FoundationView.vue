<script setup lang="ts">
import AppState from '@/components/AppState.vue'
</script>

<template>
  <div class="foundation-grid">
    <AppState kind="loading" title="统一加载状态" detail="业务模块接入后使用同一反馈结构。" />
    <AppState kind="empty" title="统一空数据状态" detail="空数据不是异常，也不伪造示例内容。" />
    <AppState kind="error" title="统一错误状态" detail="错误信息不展示堆栈、令牌或内部路径。" />
  </div>
</template>
