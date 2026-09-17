<script setup lang="ts">
defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <div
    class="help-overlay"
    :class="{ open }"
    :aria-hidden="!open"
    :inert="!open"
    @click.self="emit('close')"
  >
    <section class="help-sheet" role="dialog" aria-modal="true" aria-label="这一步在做什么">
      <div class="sheet-handle"></div>
      <div class="sheet-head">
        <div>
          <p class="sheet-title">这一步在做什么？</p>
          <p class="sheet-sub">选款式 · 第一步共四步</p>
        </div>
        <button class="btn-close" type="button" aria-label="关闭帮助" @click="emit('close')">
          ✕
        </button>
      </div>
      <div class="help-content">
        <div class="help-rule">
          <div class="help-rule-icon help-yellow">🎡</div>
          <div>
            <p class="help-rule-title">每种款式是不同的玩法</p>
            <p class="help-rule-desc">
              动盒不只是外观不同——标准款适合多帧循环，迷你款便携随身，长幅款适合横向构图，圆筒款支持360°循环播放。选款式就是选玩法。
            </p>
          </div>
        </div>
        <div class="help-rule">
          <div class="help-rule-icon help-green">🎞</div>
          <div>
            <p class="help-rule-title">点「查看玩法」了解款式特点</p>
            <p class="help-rule-desc">
              每种款式有不同的图面尺寸和帧数支持，适合不同创作风格。点「查看玩法」可查看介绍和规格价格。
            </p>
          </div>
        </div>
        <div class="help-rule">
          <div class="help-rule-icon help-blue">💰</div>
          <div>
            <p class="help-rule-title">具体规格在后面选</p>
            <p class="help-rule-desc">
              这一步只需要选款式（选玩法），具体的尺寸、材质、颜色和帧数在第三步「选配置」时再决定。
            </p>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
