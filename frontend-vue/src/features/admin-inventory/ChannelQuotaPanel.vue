<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { loadChannelQuotas, saveChannelQuota, type ChannelQuota } from './api'

type QuotaDraft = {
  taobaoQty: number
  douyinQty: number
  xhsQty: number
  bufferPool: number
  livestreamMode: boolean
}

const emit = defineEmits<{ flash: [message: string, error?: boolean] }>()
const loading = ref(true)
const busySkuId = ref('')
const rows = ref<ChannelQuota[]>([])
const drafts = reactive<Record<string, QuotaDraft>>({})
const pendingSkuId = ref('')
const pending = computed(() => rows.value.find((row) => row.skuId === pendingSkuId.value) || null)

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : '渠道配额操作失败'
}
function syncDraft(row: ChannelQuota) {
  drafts[row.skuId] = {
    taobaoQty: Number(row.taobaoQty || 0),
    douyinQty: Number(row.douyinQty || 0),
    xhsQty: Number(row.xhsQty || 0),
    bufferPool: Number(row.bufferPool ?? 10),
    livestreamMode: Boolean(row.livestreamMode)
  }
}
async function refresh() {
  loading.value = true
  try {
    rows.value = await loadChannelQuotas()
    rows.value.forEach(syncDraft)
  } catch (cause) {
    emit('flash', message(cause), true)
  } finally {
    loading.value = false
  }
}
function assigned(skuId: string) {
  const draft = drafts[skuId]
  return draft ? draft.taobaoQty + draft.douyinQty + draft.xhsQty : 0
}
function allocatable(row: ChannelQuota) {
  return Math.max(0, Number(row.available || 0) - Number(drafts[row.skuId]?.bufferPool || 0))
}
function exceeded(row: ChannelQuota) {
  return Math.max(0, assigned(row.skuId) - allocatable(row))
}
function valid(draft: QuotaDraft) {
  return [draft.taobaoQty, draft.douyinQty, draft.xhsQty, draft.bufferPool].every(
    (value) => Number.isInteger(value) && value >= 0
  )
}
async function requestSave(row: ChannelQuota) {
  const draft = drafts[row.skuId]
  if (!draft || !valid(draft)) return emit('flash', '所有配额和缓冲池必须为非负整数', true)
  if (exceeded(row) > 0) {
    pendingSkuId.value = row.skuId
    return
  }
  await persist(row, false)
}
async function persist(row: ChannelQuota, forceOversell: boolean) {
  const draft = drafts[row.skuId]
  if (!draft || !valid(draft)) return emit('flash', '所有配额和缓冲池必须为非负整数', true)
  busySkuId.value = row.skuId
  try {
    await saveChannelQuota(row.skuId, { ...draft, forceOversell: forceOversell || undefined })
    pendingSkuId.value = ''
    emit('flash', forceOversell ? '配额已强制保存，请持续关注超卖风险' : '配额已保存')
    await refresh()
  } catch (cause) {
    emit('flash', message(cause), true)
  } finally {
    busySkuId.value = ''
  }
}

defineExpose({ refresh })
onMounted(() => void refresh())
</script>

<template>
  <section class="quota-panel">
    <div class="quota-toolbar">
      <p>
        基于实时可用量为各平台分配展示库存。<b>可分配 = 可用量 − 缓冲池</b>，建议缓冲池 ≥ 10
        以应对突发。<br />当各渠道配额总和超过可分配量时，系统要求再次确认超卖风险。
      </p>
      <button class="btn" type="button" :disabled="loading" @click="refresh">↻ 刷新</button>
    </div>
    <div v-if="loading" class="empty">正在加载…</div>
    <div v-else-if="!rows.length" class="empty">📡 暂无库存记录</div>
    <div v-else class="quota-grid">
      <article v-for="row in rows" :key="row.skuId" class="quota-card">
        <div class="quota-card-top">
          <div>
            <h3>{{ row.modelName || '未知款式' }}</h3>
            <code>{{ row.skuSpec || row.skuCode || row.skuId }}</code>
          </div>
          <div class="quota-available">
            <strong :class="{ empty: row.available <= 0 }">{{ row.available }}</strong
            ><small>可用库存</small>
          </div>
        </div>
        <p class="quota-summary">
          缓冲池 <b>{{ drafts[row.skuId]?.bufferPool }}</b> → 可分配
          <strong>{{ allocatable(row) }}</strong>
        </p>
        <div v-if="exceeded(row)" class="quota-warning">
          ⚠️ 当前配额合计（{{ assigned(row.skuId) }}）超过可分配量（{{
            allocatable(row)
          }}），将存在超卖风险
        </div>
        <div v-if="drafts[row.skuId]" class="quota-fields">
          <label
            >淘宝 TB<input
              v-model.number="drafts[row.skuId]!.taobaoQty"
              type="number"
              min="0"
              step="1"
          /></label>
          <label
            >抖音 DY<input
              v-model.number="drafts[row.skuId]!.douyinQty"
              type="number"
              min="0"
              step="1"
          /></label>
          <label
            >小红书 XHS<input
              v-model.number="drafts[row.skuId]!.xhsQty"
              type="number"
              min="0"
              step="1"
          /></label>
          <label
            >缓冲池<input
              v-model.number="drafts[row.skuId]!.bufferPool"
              type="number"
              min="0"
              step="1"
          /></label>
        </div>
        <label v-if="drafts[row.skuId]" class="livestream-toggle"
          ><input
            v-model="drafts[row.skuId]!.livestreamMode"
            type="checkbox"
          />直播模式（暂停三方平台分配）</label
        >
        <button
          class="btn btn-yellow quota-save"
          type="button"
          :disabled="Boolean(busySkuId)"
          @click="requestSave(row)"
        >
          保存配额
        </button>
      </article>
    </div>

    <div v-if="pending" class="material-modal-overlay show" @click.self="pendingSkuId = ''">
      <div class="material-modal quota-confirm" role="dialog" aria-modal="true">
        <header>
          <div><h2>⚠️ 渠道配额超出可用量</h2></div>
          <button type="button" :disabled="Boolean(busySkuId)" @click="pendingSkuId = ''">×</button>
        </header>
        <p class="confirm-warn">
          配额合计 {{ assigned(pending.skuId) }} 超出可分配量 {{ allocatable(pending) }}，差额
          {{ exceeded(pending) }} 个。
        </p>
        <p class="modal-note">强行保存可能导致超卖。确认了解此风险后可继续。</p>
        <footer>
          <button class="btn" type="button" @click="pendingSkuId = ''">取消，重新调整</button
          ><button
            class="btn danger"
            type="button"
            :disabled="Boolean(busySkuId)"
            @click="persist(pending, true)"
          >
            了解风险，强制保存
          </button>
        </footer>
      </div>
    </div>
  </section>
</template>
