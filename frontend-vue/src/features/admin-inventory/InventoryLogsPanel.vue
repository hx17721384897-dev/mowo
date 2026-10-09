<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { loadGlobalInventoryLogs, type GlobalInventoryLog } from './api'

const emit = defineEmits<{ flash: [message: string, error?: boolean] }>()
const loading = ref(true)
const logs = ref<GlobalInventoryLog[]>([])
const total = ref(0)
const page = ref(1)
const limit = ref(30)
const type = ref('')
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / limit.value)))
const typeOptions = [
  ['', '全部类型'],
  ['in', '📥 入库'],
  ['out', '📤 发货出库'],
  ['reserved', '🔒 锁定'],
  ['released', '🔓 释放'],
  ['wip_frame_start', '🎞 帧图开始在制'],
  ['wip_kit_start', '🧰 材料包开始在制'],
  ['wip_kit_rollback', '↩ 材料包回滚'],
  ['wip_defect_frame', '💥 帧图报废'],
  ['wip_deduct', '✅ 生产完成核销'],
  ['kit_assembled', '🧰 材料包入库'],
  ['return_recovered', '↩ 退回检查合格'],
  ['manual_adjustment', '🔧 手动修正']
] as const
const typeLabel = Object.fromEntries(typeOptions)
const positiveTypes = new Set(['in', 'released', 'kit_assembled', 'return_recovered'])

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : '变动记录加载失败'
}
async function refresh(nextPage = page.value) {
  loading.value = true
  try {
    const result = await loadGlobalInventoryLogs({ page: nextPage, limit: 30, type: type.value })
    logs.value = result.logs
    total.value = result.total
    page.value = result.page
    limit.value = result.limit
  } catch (cause) {
    logs.value = []
    emit('flash', message(cause), true)
  } finally {
    loading.value = false
  }
}
function changeType() {
  void refresh(1)
}
function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

defineExpose({ refresh })
onMounted(() => void refresh(1))
</script>

<template>
  <section class="inventory-logs-panel">
    <div class="logs-toolbar">
      <select v-model="type" aria-label="变动类型" @change="changeType">
        <option v-for="option in typeOptions" :key="option[0]" :value="option[0]">
          {{ option[1] }}
        </option>
      </select>
      <button class="btn" type="button" :disabled="loading" @click="refresh(page)">↻ 刷新</button>
    </div>
    <div class="table-wrap global-log-table">
      <div class="global-log-header">
        <div>时间</div>
        <div>款式 · 规格</div>
        <div>类型</div>
        <div>数量</div>
        <div>操作人</div>
        <div>备注</div>
      </div>
      <div v-if="loading" class="empty">正在加载…</div>
      <div v-else-if="!logs.length" class="empty">📋 暂无记录</div>
      <div v-for="log in logs" v-else :key="log.id" class="global-log-row">
        <time>{{ formatTime(log.createdAt) }}</time>
        <div>
          <strong>{{ log.modelName || '—' }}</strong
          ><small>{{ log.skuSpec || '—' }}</small>
        </div>
        <span class="global-log-type">{{ typeLabel[log.type] || log.type }}</span>
        <b :class="positiveTypes.has(log.type) ? 'positive' : 'negative'"
          >{{ positiveTypes.has(log.type) ? '+' : '-' }}{{ Math.abs(log.quantity) }}</b
        >
        <code>{{ (log.operatorId || '').slice(-8) }}</code>
        <span>{{ log.note || log.reason || '—' }}</span>
      </div>
      <div v-if="pageCount > 1" class="pagination">
        <span>共 {{ total }} 条</span>
        <button
          v-for="number in Math.min(pageCount, 10)"
          :key="number"
          type="button"
          :class="{ active: page === number }"
          @click="refresh(number)"
        >
          {{ number }}
        </button>
      </div>
    </div>
  </section>
</template>
