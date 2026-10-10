<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ApiError } from '@/services/api-client'
import { useSessionStore } from '@/stores/session'
import {
  addFramePackVariant,
  addFramePackWork,
  adjustFramePack,
  loadFramePacks,
  restockFramePack,
  searchFramePackCollabs,
  type AlertLevel,
  type FramePackCollabResult,
  type FramePackVariant,
  type FramePackWork
} from './api'

const emit = defineEmits<{ flash: [message: string, error?: boolean] }>()
const session = useSessionStore()
const loading = ref(true)
const busy = ref(false)
const rows = ref<FramePackWork[]>([])
const search = ref('')
const filter = ref<AlertLevel | ''>('')
const expanded = ref(new Set<string>())
const modal = ref<'' | 'work' | 'variant' | 'restock' | 'adjust'>('')
const selectedWork = ref<FramePackWork | null>(null)
const selectedVariant = ref<FramePackVariant | null>(null)
const collabQuery = ref('')
const collabResults = ref<FramePackCollabResult[]>([])
const selectedCollab = ref<FramePackCollabResult | null>(null)
const variantForm = reactive({
  size: '',
  frameCount: 0,
  skuCode: '',
  safetyStock: 5,
  leadTime: 7,
  note: ''
})
const stockForm = reactive({ quantity: 0, note: '' })
const isOwner = computed(() => session.staffRole === 'OWNER')
const filtered = computed(() => {
  const query = search.value.trim().toLowerCase()
  return rows.value.filter((row) => {
    if (filter.value && row.worstAlert !== filter.value) return false
    return (
      !query ||
      row.name.toLowerCase().includes(query) ||
      row.variants.some((item) => (item.skuCode || '').toLowerCase().includes(query))
    )
  })
})
const stats = computed(() => ({
  total: rows.value.length,
  critical: rows.value.filter((row) => row.worstAlert === 'CRITICAL').length,
  warning: rows.value.filter((row) => row.worstAlert === 'WARNING').length
}))
const badge: Record<AlertLevel, string> = {
  CRITICAL: '🔴 紧急不足',
  WARNING: '🟡 库存偏低',
  SUGGEST: '🔵 建议补货',
  OK: '✅ 充足'
}

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : '帧包库存操作失败'
}
async function refresh() {
  loading.value = true
  try {
    rows.value = await loadFramePacks()
  } catch (cause) {
    emit('flash', message(cause), true)
  } finally {
    loading.value = false
  }
}
function toggle(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}
function requestKey(action: string, target: string, payload: object) {
  const key = `mowo.framePack.${action}.${target}`
  const fingerprint = JSON.stringify(payload)
  try {
    const pending = JSON.parse(sessionStorage.getItem(key) || 'null') as {
      fingerprint?: string
      clientRequestId?: string
    } | null
    if (pending?.fingerprint === fingerprint && pending.clientRequestId)
      return { key, clientRequestId: pending.clientRequestId }
  } catch {
    /* replace malformed state */
  }
  const clientRequestId = `frame-pack-${crypto.randomUUID()}`
  sessionStorage.setItem(key, JSON.stringify({ fingerprint, clientRequestId }))
  return { key, clientRequestId }
}
function clearOnHandled(cause: unknown, key: string) {
  if (cause instanceof ApiError && cause.status > 0) sessionStorage.removeItem(key)
}
function close() {
  if (!busy.value) modal.value = ''
}
async function searchCollabs() {
  const query = collabQuery.value.trim()
  if (!query) {
    collabResults.value = []
    return
  }
  try {
    collabResults.value = await searchFramePackCollabs(query)
  } catch (cause) {
    emit('flash', message(cause), true)
  }
}
function openWork() {
  selectedCollab.value = null
  collabQuery.value = ''
  collabResults.value = []
  modal.value = 'work'
}
async function submitWork() {
  if (!selectedCollab.value) return emit('flash', '请先搜索并选择一个联名作品', true)
  const payload = { collabWorkId: selectedCollab.value.id }
  const pending = requestKey('work', payload.collabWorkId, payload)
  busy.value = true
  try {
    const result = await addFramePackWork({ ...payload, clientRequestId: pending.clientRequestId })
    sessionStorage.removeItem(pending.key)
    modal.value = ''
    emit('flash', result.reused ? '已恢复添加结果，没有创建重复作品' : '已添加到帧包白名单')
    await refresh()
  } catch (cause) {
    clearOnHandled(cause, pending.key)
    emit('flash', message(cause), true)
  } finally {
    busy.value = false
  }
}
function openVariant(work: FramePackWork) {
  selectedWork.value = work
  Object.assign(variantForm, {
    size: '',
    frameCount: 0,
    skuCode: '',
    safetyStock: 5,
    leadTime: 7,
    note: ''
  })
  modal.value = 'variant'
}
async function submitVariant() {
  const work = selectedWork.value
  if (
    !work ||
    !variantForm.size.trim() ||
    !Number.isInteger(variantForm.frameCount) ||
    variantForm.frameCount <= 0 ||
    !Number.isInteger(variantForm.safetyStock) ||
    variantForm.safetyStock < 0 ||
    !Number.isInteger(variantForm.leadTime) ||
    variantForm.leadTime <= 0
  )
    return emit('flash', '请检查尺寸、帧数、安全库存和采购周期', true)
  const payload = {
    size: variantForm.size.trim(),
    frameCount: variantForm.frameCount,
    skuCode: variantForm.skuCode.trim() || undefined,
    safetyStock: variantForm.safetyStock,
    leadTime: variantForm.leadTime,
    note: variantForm.note.trim() || undefined
  }
  const pending = requestKey('variant', `${work.id}-${payload.size}-${payload.frameCount}`, payload)
  busy.value = true
  try {
    const result = await addFramePackVariant(work.id, {
      ...payload,
      clientRequestId: pending.clientRequestId
    })
    sessionStorage.removeItem(pending.key)
    modal.value = ''
    emit('flash', result.reused ? '已恢复规格添加结果，没有重复创建' : '规格变体已添加')
    await refresh()
  } catch (cause) {
    clearOnHandled(cause, pending.key)
    emit('flash', message(cause), true)
  } finally {
    busy.value = false
  }
}
function openStock(work: FramePackWork, variant: FramePackVariant, kind: 'restock' | 'adjust') {
  selectedWork.value = work
  selectedVariant.value = variant
  Object.assign(stockForm, { quantity: 0, note: '' })
  modal.value = kind
}
async function submitStock() {
  const work = selectedWork.value,
    variant = selectedVariant.value,
    kind = modal.value
  if (!work || !variant || !Number.isInteger(stockForm.quantity) || stockForm.quantity === 0)
    return emit('flash', '请输入有效的整数数量', true)
  if (kind === 'restock' && stockForm.quantity < 1) return emit('flash', '入库数量必须大于 0', true)
  if (kind === 'adjust' && !stockForm.note.trim())
    return emit('flash', '手动调整必须填写原因', true)
  const payload =
    kind === 'restock'
      ? { quantity: stockForm.quantity, note: stockForm.note.trim() || undefined }
      : { delta: stockForm.quantity, note: stockForm.note.trim() }
  const pending = requestKey(kind, variant.id, payload)
  busy.value = true
  try {
    const result =
      kind === 'restock'
        ? await restockFramePack(work.id, variant.id, {
            quantity: stockForm.quantity,
            note: stockForm.note.trim() || undefined,
            clientRequestId: pending.clientRequestId
          })
        : await adjustFramePack(work.id, variant.id, {
            delta: stockForm.quantity,
            note: stockForm.note.trim(),
            clientRequestId: pending.clientRequestId
          })
    sessionStorage.removeItem(pending.key)
    modal.value = ''
    emit(
      'flash',
      result.reused
        ? '已恢复上次结果，没有重复增减库存'
        : kind === 'restock'
          ? '帧包入库成功'
          : '帧包库存已调整'
    )
    await refresh()
  } catch (cause) {
    clearOnHandled(cause, pending.key)
    emit('flash', message(cause), true)
  } finally {
    busy.value = false
  }
}

defineExpose({ refresh })
onMounted(() => void refresh())
</script>

<template>
  <section class="frame-pack-panel">
    <div class="fp-stats">
      <div class="stat-card">
        <span>管理款式数</span><strong>{{ stats.total }}</strong
        ><small>白名单作品</small>
      </div>
      <div class="stat-card critical">
        <span>紧急不足</span><strong>{{ stats.critical }}</strong
        ><small>有变体库存告急</small>
      </div>
      <div class="stat-card warning">
        <span>库存偏低</span><strong>{{ stats.warning }}</strong
        ><small>建议近期补货</small>
      </div>
    </div>
    <div class="fp-toolbar">
      <input v-model="search" class="search-input" placeholder="🔍 搜索作品名称或变体编码…" />
      <div class="filter-tabs">
        <button
          v-for="item in [
            { v: '', t: '全部' },
            { v: 'CRITICAL', t: '🔴 紧急' },
            { v: 'WARNING', t: '🟡 偏低' },
            { v: 'OK', t: '✅ 充足' }
          ]"
          :key="item.v"
          class="filter-tab"
          :class="{ active: filter === item.v }"
          type="button"
          @click="filter = item.v as AlertLevel | ''"
        >
          {{ item.t }}
        </button>
      </div>
      <span class="fp-spacer"></span
      ><button class="btn btn-sm" type="button" @click="refresh">↻ 刷新</button
      ><button v-if="isOwner" class="btn btn-black btn-sm" type="button" @click="openWork">
        + 添加作品
      </button>
    </div>
    <div v-if="loading" class="empty">正在加载…</div>
    <div v-else-if="!filtered.length" class="empty">
      🎞 暂无帧包库存记录，点击「添加作品」开始管理
    </div>
    <article v-for="work in filtered" v-else :key="work.id" class="fp-work-card">
      <header class="fp-work-header" @click="toggle(work.id)">
        <img v-if="work.thumbnailUrl" class="fp-work-thumb" :src="work.thumbnailUrl" alt="" />
        <div v-else class="fp-work-thumb-placeholder">🎞</div>
        <div class="fp-work-copy">
          <div>
            <i class="alert-dot" :class="work.worstAlert.toLowerCase()"></i>
            <h3>{{ work.name }}</h3>
          </div>
          <p>
            {{ work.variants.length }} 种规格 · 合计
            {{ work.variants.reduce((sum, item) => sum + item.currentStock, 0) }} 套在库
            <span class="fp-badge" :class="work.worstAlert.toLowerCase()">{{
              badge[work.worstAlert]
            }}</span>
          </p>
        </div>
        <button v-if="isOwner" class="btn btn-sm" type="button" @click.stop="openVariant(work)">
          + 规格</button
        ><button class="fp-expand-btn" type="button">
          {{ expanded.has(work.id) ? '▴' : '▾' }}
        </button>
      </header>
      <div v-if="expanded.has(work.id)" class="fp-variants">
        <div class="fp-variant-header">
          <span>规格</span><span>现货</span><span>安全线</span><span>周期</span><span>预警</span
          ><span>操作</span>
        </div>
        <div v-for="variant in work.variants" :key="variant.id" class="fp-variant-row">
          <span
            ><b>{{ variant.size }} · {{ variant.frameCount }}帧</b
            ><code v-if="variant.skuCode">{{ variant.skuCode }}</code></span
          ><strong>{{ variant.currentStock }}</strong
          ><span>{{ variant.safetyStock }}</span
          ><span>{{ variant.leadTime }}天</span
          ><span class="fp-badge" :class="variant.alertLevel.toLowerCase()">{{
            badge[variant.alertLevel]
          }}</span
          ><span class="fp-actions"
            ><button class="btn btn-sm" type="button" @click="openStock(work, variant, 'restock')">
              入库</button
            ><button
              v-if="isOwner"
              class="btn btn-sm"
              type="button"
              @click="openStock(work, variant, 'adjust')"
            >
              调整
            </button></span
          >
        </div>
        <div v-if="isOwner" class="fp-add-row">
          <button class="btn btn-sm" type="button" @click="openVariant(work)">
            + 添加规格变体
          </button>
        </div>
      </div>
    </article>

    <div v-if="modal" class="material-modal-overlay show" @click.self="close">
      <div class="material-modal fp-modal" role="dialog" aria-modal="true">
        <header>
          <div>
            <h2>
              {{
                modal === 'work'
                  ? '添加帧包作品'
                  : modal === 'variant'
                    ? '添加规格变体'
                    : modal === 'restock'
                      ? '📥 帧包入库'
                      : '🔧 手动调整库存'
              }}
            </h2>
            <p v-if="selectedWork && modal !== 'work'">
              {{ selectedWork.name
              }}<template v-if="selectedVariant">
                · {{ selectedVariant.size }} · {{ selectedVariant.frameCount }}帧</template
              >
            </p>
          </div>
          <button type="button" :disabled="busy" @click="close">×</button>
        </header>
        <template v-if="modal === 'work'">
          <label
            >搜索联名作品<input
              v-model="collabQuery"
              placeholder="输入作品名称…"
              @input="searchCollabs"
          /></label>
          <div class="fp-collab-results">
            <button
              v-for="item in collabResults"
              :key="item.id"
              type="button"
              :disabled="item.alreadyAdded"
              :class="{ selected: selectedCollab?.id === item.id }"
              @click="selectedCollab = item"
            >
              <span>🎞</span><b>{{ item.title }}</b
              ><small>{{ item.alreadyAdded ? '已在白名单' : '选择' }}</small>
            </button>
          </div>
          <p v-if="selectedCollab" class="fp-selected">
            已选择：<b>{{ selectedCollab.title }}</b>
          </p>
          <footer>
            <button class="btn" type="button" @click="close">取消</button
            ><button class="btn btn-black" type="button" :disabled="busy" @click="submitWork">
              添加到白名单
            </button>
          </footer>
        </template>
        <form v-else-if="modal === 'variant'" @submit.prevent="submitVariant">
          <div class="fp-form-grid">
            <label>尺寸 *<input v-model="variantForm.size" placeholder="如 5x5cm" /></label
            ><label
              >帧数 *<input v-model.number="variantForm.frameCount" type="number" min="1" step="1"
            /></label>
          </div>
          <label>SKU 编码（选填）<input v-model="variantForm.skuCode" /></label>
          <div class="fp-form-grid">
            <label
              >安全库存<input
                v-model.number="variantForm.safetyStock"
                type="number"
                min="0"
                step="1" /></label
            ><label
              >采购周期（天）<input
                v-model.number="variantForm.leadTime"
                type="number"
                min="1"
                step="1"
            /></label>
          </div>
          <label>备注（选填）<input v-model="variantForm.note" /></label>
          <footer>
            <button class="btn" type="button" @click="close">取消</button
            ><button class="btn btn-black" type="submit" :disabled="busy">添加变体</button>
          </footer>
        </form>
        <form v-else @submit.prevent="submitStock">
          <label
            >{{ modal === 'restock' ? '入库数量 *' : '调整量（正数增加，负数减少）*'
            }}<input
              v-model.number="stockForm.quantity"
              type="number"
              :min="modal === 'restock' ? 1 : undefined"
              step="1" /></label
          ><label
            >{{ modal === 'restock' ? '备注（选填）' : '原因 *'
            }}<input
              v-model="stockForm.note"
              :placeholder="modal === 'restock' ? '供应商/批次等' : '必填：盘点/报损/修正等'"
          /></label>
          <footer>
            <button class="btn" type="button" @click="close">取消</button
            ><button class="btn btn-black" type="submit" :disabled="busy">
              {{ modal === 'restock' ? '确认入库' : '确认调整' }}
            </button>
          </footer>
        </form>
      </div>
    </div>
  </section>
</template>
