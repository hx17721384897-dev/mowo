<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ApiError } from '@/services/api-client'
import {
  createReturnReplacement,
  inspectInventoryReturn,
  loadInventoryReturns,
  loadMaterials,
  receiveInventoryReturn,
  type InventoryReturnReceipt,
  type MaterialItem
} from './api'

const emit = defineEmits<{
  flash: [message: string, error?: boolean]
  inventoryChanged: []
}>()
const route = useRoute()
const loading = ref(true)
const busy = ref(false)
const rows = ref<InventoryReturnReceipt[]>([])
const materials = ref<MaterialItem[]>([])
const modal = ref<'' | 'receive' | 'inspect'>('')
const selected = ref<InventoryReturnReceipt | null>(null)
const receive = reactive({ aftersaleRequestId: '', trackingCompany: '', trackingNo: '', note: '' })
const inspection = reactive({
  packageCondition: 'UNOPENED_INTACT' as 'UNOPENED_INTACT' | 'OPENED',
  receivedQty: 1,
  materialId: '',
  materialQty: 1,
  disposition: 'SERVICE_ONLY',
  note: ''
})
const storagePrefix = 'mowo.inventory.returnMutation'

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : '操作失败'
}
function mutationKey(action: string, targetId: string, payload: unknown) {
  const key = `${storagePrefix}.${encodeURIComponent(action)}.${encodeURIComponent(targetId)}`
  const fingerprint = JSON.stringify(payload)
  try {
    const pending = JSON.parse(sessionStorage.getItem(key) || 'null') as {
      fingerprint?: string
      clientRequestId?: string
    } | null
    if (pending?.fingerprint === fingerprint && pending.clientRequestId)
      return pending.clientRequestId
  } catch {
    // Replace malformed pending state below.
  }
  const clientRequestId = `return-${crypto.randomUUID()}`
  sessionStorage.setItem(key, JSON.stringify({ fingerprint, clientRequestId }))
  return clientRequestId
}
function clearMutation(action: string, targetId: string, cause?: unknown) {
  if (cause instanceof ApiError && (cause.status === 0 || cause.status >= 500)) return
  sessionStorage.removeItem(
    `${storagePrefix}.${encodeURIComponent(action)}.${encodeURIComponent(targetId)}`
  )
}
async function refresh() {
  loading.value = true
  try {
    rows.value = await loadInventoryReturns()
  } catch (cause) {
    emit('flash', message(cause), true)
  } finally {
    loading.value = false
  }
}
function openReceive() {
  receive.aftersaleRequestId = String(route.query.aftersaleId || '')
  receive.trackingCompany = ''
  receive.trackingNo = ''
  receive.note = ''
  modal.value = 'receive'
}
async function submitReceive() {
  const aftersaleRequestId = receive.aftersaleRequestId.trim()
  if (!aftersaleRequestId) return emit('flash', '请填写售后申请 ID', true)
  const payload = {
    aftersaleRequestId,
    trackingCompany: receive.trackingCompany.trim(),
    trackingNo: receive.trackingNo.trim(),
    note: receive.note.trim()
  }
  const clientRequestId = mutationKey('RETURN_RECEIVE', aftersaleRequestId, payload)
  busy.value = true
  try {
    const result = await receiveInventoryReturn({ ...payload, clientRequestId })
    clearMutation('RETURN_RECEIVE', aftersaleRequestId)
    emit('flash', result.reused ? '退回收货结果已恢复，没有重复登记' : '已收货并进入隔离区')
    modal.value = ''
    await refresh()
  } catch (cause) {
    clearMutation('RETURN_RECEIVE', aftersaleRequestId, cause)
    emit('flash', message(cause), true)
  } finally {
    busy.value = false
  }
}
async function openInspect(row: InventoryReturnReceipt) {
  selected.value = row
  Object.assign(inspection, {
    packageCondition: 'UNOPENED_INTACT',
    receivedQty: 1,
    materialId: '',
    materialQty: 1,
    disposition: 'SERVICE_ONLY',
    note: ''
  })
  modal.value = 'inspect'
  try {
    if (!materials.value.length) materials.value = await loadMaterials()
  } catch (cause) {
    emit('flash', message(cause), true)
  }
}
async function submitInspection() {
  if (!selected.value) return
  if (!Number.isInteger(inspection.receivedQty) || inspection.receivedQty < 1)
    return emit('flash', '收回数量必须为正整数', true)
  if (
    inspection.packageCondition === 'OPENED' &&
    (!Number.isInteger(inspection.materialQty) || inspection.materialQty < 1)
  )
    return emit('flash', '逐项检查数量必须为正整数', true)
  if (
    inspection.packageCondition === 'OPENED' &&
    inspection.disposition === 'SERVICE_ONLY' &&
    !inspection.materialId
  )
    return emit('flash', '维修备用必须选择可复用基础零件', true)
  const payload = {
    packageCondition: inspection.packageCondition,
    receivedQty: inspection.receivedQty,
    items:
      inspection.packageCondition === 'OPENED'
        ? [
            {
              inventoryLevel:
                inspection.disposition === 'PRIVATE_DESTROY' ? 'PRIVATE_FRAME' : 'BASE',
              materialId: inspection.materialId || undefined,
              receivedQty: inspection.materialQty,
              disposition: inspection.disposition
            }
          ]
        : [],
    note: inspection.note.trim()
  }
  if (
    !window.confirm(
      inspection.packageCondition === 'UNOPENED_INTACT'
        ? '确认该完整材料包未拆封且检查合格，并以新的回收批次进入新品库存？'
        : '确认按当前检查结论处理？'
    )
  )
    return
  const id = selected.value.id
  const clientRequestId = mutationKey('RETURN_INSPECT', id, payload)
  busy.value = true
  try {
    const result = await inspectInventoryReturn(id, { ...payload, clientRequestId })
    clearMutation('RETURN_INSPECT', id)
    emit('flash', result.reused ? '检查结果已恢复，没有重复回库' : '退回检查已完成')
    modal.value = ''
    await refresh()
    emit('inventoryChanged')
  } catch (cause) {
    clearMutation('RETURN_INSPECT', id, cause)
    emit('flash', message(cause), true)
  } finally {
    busy.value = false
  }
}
async function createReplacement(row: InventoryReturnReceipt) {
  if (!window.confirm('确认创建一个新的补发生产任务？原生产任务不会被重新打开。')) return
  const payload = {}
  const clientRequestId = mutationKey('RETURN_REPLACEMENT', row.id, payload)
  busy.value = true
  try {
    const result = await createReturnReplacement(row.id, { clientRequestId })
    clearMutation('RETURN_REPLACEMENT', row.id)
    emit('flash', result.reused ? '补发任务结果已恢复，没有重复创建' : '补发生产任务已创建')
  } catch (cause) {
    clearMutation('RETURN_REPLACEMENT', row.id, cause)
    emit('flash', message(cause), true)
  } finally {
    busy.value = false
  }
}
function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

defineExpose({ refresh })
onMounted(() => void refresh())
</script>

<template>
  <section class="return-panel">
    <div class="material-toolbar">
      <p class="material-help">
        退回件先登记收货并隔离，检查后才能进入新品库存、维修备用或报废。发出退货快递不会自动增加库存。
      </p>
      <button class="btn btn-black" type="button" @click="openReceive">＋ 登记退回收货</button>
    </div>
    <div v-if="loading" class="empty">正在加载…</div>
    <div v-else-if="!rows.length" class="empty">暂无退回收货记录</div>
    <div v-else class="return-list">
      <article v-for="row in rows" :key="row.id" class="material-card return-card">
        <div class="material-card-head">
          <div>
            <h3>{{ row.returnNo }}</h3>
            <p>
              原生产任务 {{ row.aftersale?.order?.orderNo || row.orderId }} · 售后
              {{ row.aftersaleRequestId }}
            </p>
          </div>
          <span class="stock-badge" :class="row.status === 'QUARANTINED' ? 'warning' : 'ok'">
            {{ row.status === 'QUARANTINED' ? '待检查（隔离中）' : '已检查' }}
          </span>
        </div>
        <p class="return-meta">
          {{ row.trackingCompany ? `${row.trackingCompany} · ` : ''
          }}{{ row.trackingNo || '未填写快递单号' }} · {{ formatTime(row.receivedAt) }}
        </p>
        <div class="material-actions">
          <button
            v-if="row.status === 'QUARANTINED'"
            class="btn btn-sm btn-black"
            type="button"
            :disabled="busy"
            @click="openInspect(row)"
          >
            开始检查
          </button>
          <button class="btn btn-sm" type="button" :disabled="busy" @click="createReplacement(row)">
            创建补发任务
          </button>
        </div>
      </article>
    </div>

    <div v-if="modal" class="material-modal-overlay show" @click.self="!busy && (modal = '')">
      <div class="material-modal" role="dialog" aria-modal="true">
        <header>
          <div>
            <h2>{{ modal === 'receive' ? '登记退回收货' : '退回件检查' }}</h2>
            <p v-if="modal === 'receive'">
              请先在订单后台同意售后，再填写该售后申请编号。收货后物品先进入隔离区。
            </p>
            <p v-else>{{ selected?.returnNo }}：检查前仍属于隔离库存</p>
          </div>
          <button type="button" :disabled="busy" @click="modal = ''">×</button>
        </header>
        <form v-if="modal === 'receive'" @submit.prevent="submitReceive">
          <label>售后申请 ID *<input v-model.trim="receive.aftersaleRequestId" /></label>
          <div class="form-pair">
            <label>快递公司<input v-model.trim="receive.trackingCompany" /></label>
            <label>退回快递单号<input v-model.trim="receive.trackingNo" /></label>
          </div>
          <label>收货备注<input v-model.trim="receive.note" /></label>
          <footer>
            <button class="btn" type="button" @click="modal = ''">取消</button
            ><button class="btn btn-black" :disabled="busy">确认收货并隔离</button>
          </footer>
        </form>
        <form v-else @submit.prevent="submitInspection">
          <label
            >包装与使用情况 *<select v-model="inspection.packageCondition">
              <option value="UNOPENED_INTACT">未拆封、完整且检查合格</option>
              <option value="OPENED">已拆封或使用过</option>
            </select></label
          >
          <label
            >数量 *<input v-model.number="inspection.receivedQty" type="number" min="1" step="1"
          /></label>
          <div v-if="inspection.packageCondition === 'OPENED'" class="return-opened-fields">
            <p>已拆封的胶、蜡、铁丝不能回到新品库存。可复用木板或支架可登记到维修备用库存。</p>
            <label
              >可复用基础零件（可选）<select v-model="inspection.materialId">
                <option value="">请选择基础零件</option>
                <option
                  v-for="item in materials.filter((row) => row.itemType !== 'PACKED')"
                  :key="item.id"
                  :value="item.id"
                >
                  {{ item.name }} · {{ item.specification || '' }}
                </option>
              </select></label
            >
            <div class="form-pair">
              <label
                >零件数量<input
                  v-model.number="inspection.materialQty"
                  type="number"
                  min="1"
                  step="1" /></label
              ><label
                >处理方式<select v-model="inspection.disposition">
                  <option value="SERVICE_ONLY">维修备用</option>
                  <option value="SCRAP">报废</option>
                  <option value="MISSING">缺失</option>
                  <option value="PRIVATE_DESTROY">私人帧素材销毁</option>
                </select></label
              >
            </div>
          </div>
          <label>检查备注<input v-model.trim="inspection.note" /></label>
          <footer>
            <button class="btn" type="button" @click="modal = ''">取消</button
            ><button class="btn btn-black" :disabled="busy">确认检查结论</button>
          </footer>
        </form>
      </div>
    </div>
  </section>
</template>
