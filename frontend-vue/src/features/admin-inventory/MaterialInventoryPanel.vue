<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ApiError } from '@/services/api-client'
import {
  addMaterialFormOption,
  adjustMaterial,
  assembleKit,
  createMaterial,
  defectMaterial,
  loadMaterialBindings,
  loadMaterialFormOptions,
  loadMaterialLot,
  loadMaterialLots,
  loadMaterialLogs,
  loadMaterials,
  prepareMaterial,
  previewKitAssembly,
  previewPreparation,
  removeMaterialFormOption,
  restockMaterial,
  updateMaterial,
  type AlertLevel,
  type InventoryRow,
  type MaterialBinding,
  type MaterialFormOption,
  type MaterialItem,
  type MaterialLog,
  type MaterialLot,
  type MaterialPlan
} from './api'

const props = defineProps<{ mode: 'PACKED' | 'RAW'; inventory: InventoryRow[] }>()
const emit = defineEmits<{ flash: [message: string, error?: boolean]; inventoryChanged: [] }>()
const items = ref<MaterialItem[]>([]),
  loading = ref(false),
  busy = ref(false)
const filter = ref<AlertLevel | ''>(''),
  selected = ref<MaterialItem | null>(null)
const logs = ref<MaterialLog[]>([]),
  bindings = ref<MaterialBinding[]>([])
const lots = ref<MaterialLot[]>([]),
  lotMaterial = ref<MaterialItem | null>(null),
  lotDetail = ref<MaterialLot | null>(null)
const modal = ref<
  | ''
  | 'detail'
  | 'lots'
  | 'restock'
  | 'prepare'
  | 'assemble'
  | 'allocation'
  | 'definition'
  | 'defect'
  | 'adjust'
>('')
const receipt = reactive({
  acceptedQty: 0,
  rejectedQty: 0,
  orderedSpec: '',
  supplierName: '',
  supplierLotNo: '',
  location: '',
  note: ''
})
const preparation = reactive({ outputQty: 0, lossQty: 0, location: '', note: '' })
const preparationPlan = ref<(MaterialPlan & { outputQty: number; lossQty: number }) | null>(null)
const preparationOverride = ref<Array<{ sourceBatchId: string; quantity: number }> | undefined>()
const assembly = reactive({ skuId: '', quantity: 0, boxCode: '', location: '', note: '' })
const assemblyPlan = ref<{ skuId: string; quantity: number; plan: MaterialPlan[] } | null>(null)
const assemblyOverrides = reactive<
  Record<string, Array<{ sourceBatchId: string; quantity: number }>>
>({})
const definition = reactive({
  id: '',
  name: '',
  itemType: 'RAW' as MaterialItem['itemType'],
  specification: '',
  unit: '个',
  safetyStock: 10,
  leadTime: 7,
  note: '',
  sourceMaterialId: '',
  sourceQtyPerUnit: 0
})
const formOptions = reactive<{ names: MaterialFormOption[]; units: MaterialFormOption[] }>({
  names: [],
  units: []
})
const newOption = reactive({ name: '', unit: '' })
const stockChange = reactive({ quantity: 0, note: '' })
const allocation = reactive({
  mode: 'prepare' as 'prepare' | 'kit',
  materialId: '',
  requiredQty: 0,
  unit: '',
  name: '',
  values: {} as Record<string, number>
})

const shown = computed(() =>
  items.value.filter((item) => {
    const layer = props.mode === 'PACKED' ? item.itemType === 'PACKED' : item.itemType !== 'PACKED'
    if (!layer) return false
    if (!filter.value) return true
    if (filter.value === 'OK') return ['OK', 'SUGGEST'].includes(item.alertLevel)
    return item.alertLevel === filter.value
  })
)
const filterOptions: Array<{ value: AlertLevel | ''; label: string }> = [
  { value: '', label: '全部' },
  { value: 'CRITICAL', label: '🔴 紧急不足' },
  { value: 'WARNING', label: '🟡 库存偏低' },
  { value: 'OK', label: '✅ 充足' }
]
const alertText: Record<AlertLevel, string> = {
  OK: '✅ 充足',
  SUGGEST: '🔵 采购',
  WARNING: '🟡 偏低',
  CRITICAL: '🔴 紧急'
}
const logText: Record<string, string> = {
  purchase_in: '📥 采购入库',
  opening_stock: '🗂 期初录入',
  preparation_consumed: '📤 分装使用',
  preparation_produced: '📦 分装完成',
  kit_assembly_consumed: '🧰 材料包组装使用',
  production_defect: '💥 生产报损',
  manual_adjustment: '🔧 人工调整'
}

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : '操作失败'
}
function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}
function typeLabel(item: MaterialItem) {
  return ({ RAW: '散装/基础', PACKED: '已分装', CONSUMABLE: '直接耗材' } as const)[item.itemType]
}
function storageKey(action: string, target: string) {
  return `mowo.inventory.pendingMaterialMutation.${encodeURIComponent(action)}.${encodeURIComponent(target)}`
}
function mutationId(action: string, target: string, payload: Record<string, unknown>) {
  const key = storageKey(action, target),
    fingerprint = JSON.stringify(payload)
  try {
    const row = JSON.parse(sessionStorage.getItem(key) || 'null') as {
      fingerprint?: string
      clientRequestId?: string
    } | null
    if (row?.fingerprint === fingerprint && row.clientRequestId) return row.clientRequestId
  } catch {
    /* replace malformed state */
  }
  const clientRequestId = `material-${crypto.randomUUID()}`
  sessionStorage.setItem(key, JSON.stringify({ fingerprint, clientRequestId }))
  return clientRequestId
}
function clearMutation(action: string, target: string, cause?: unknown) {
  if (!cause || (cause instanceof ApiError && cause.status > 0 && cause.status < 500))
    sessionStorage.removeItem(storageKey(action, target))
}
async function refresh() {
  loading.value = true
  try {
    items.value = await loadMaterials()
  } catch (cause) {
    emit('flash', message(cause), true)
  } finally {
    loading.value = false
  }
}
async function openDetail(item: MaterialItem) {
  selected.value = item
  modal.value = 'detail'
  logs.value = []
  bindings.value = []
  try {
    ;[logs.value, bindings.value] = await Promise.all([
      loadMaterialLogs(item.id).then((v) => v.logs),
      loadMaterialBindings(item.id)
    ])
  } catch (cause) {
    emit('flash', message(cause), true)
  }
}
async function openLots(item: MaterialItem) {
  selected.value = item
  lotDetail.value = null
  modal.value = 'lots'
  try {
    const data = await loadMaterialLots(item.id)
    lotMaterial.value = data.material
    lots.value = data.lots
  } catch (cause) {
    emit('flash', message(cause), true)
  }
}
async function inspectLot(lot: MaterialLot) {
  const type = lotMaterial.value?.itemType === 'PACKED' ? 'PREPARATION' : 'RECEIPT'
  try {
    lotDetail.value = await loadMaterialLot(type, lot.id)
  } catch (cause) {
    emit('flash', message(cause), true)
  }
}
function openRestock(item: MaterialItem) {
  selected.value = item
  Object.assign(receipt, {
    acceptedQty: 0,
    rejectedQty: 0,
    orderedSpec: '',
    supplierName: '',
    supplierLotNo: '',
    location: '',
    note: ''
  })
  modal.value = 'restock'
}
async function submitRestock() {
  if (!selected.value || !Number.isInteger(receipt.acceptedQty) || receipt.acceptedQty <= 0)
    return emit('flash', '请填写实际合格数量', true)
  if (!Number.isInteger(receipt.rejectedQty) || receipt.rejectedQty < 0)
    return emit('flash', '次品数量不能为负数', true)
  const target = selected.value.id
  const payload = { ...receipt, actualQty: receipt.acceptedQty + receipt.rejectedQty }
  const clientRequestId = mutationId('MATERIAL_RESTOCK', target, payload)
  busy.value = true
  try {
    const result = await restockMaterial(target, { ...payload, clientRequestId })
    clearMutation('MATERIAL_RESTOCK', target)
    emit(
      'flash',
      result.reused ? '入库结果已恢复，没有重复增加库存' : `入库完成，批次 ${result.receiptNo}`
    )
    modal.value = ''
    await refresh()
  } catch (cause) {
    clearMutation('MATERIAL_RESTOCK', target, cause)
    emit('flash', message(cause), true)
  } finally {
    busy.value = false
  }
}
function openPrepare(item: MaterialItem) {
  selected.value = item
  Object.assign(preparation, { outputQty: 0, lossQty: 0, location: '', note: '' })
  preparationPlan.value = null
  preparationOverride.value = undefined
  modal.value = 'prepare'
}
let previewTimer: number | undefined
watch(
  () => [preparation.outputQty, preparation.lossQty],
  () => {
    preparationOverride.value = undefined
    window.clearTimeout(previewTimer)
    previewTimer = window.setTimeout(() => void updatePreparationPreview(), 180)
  }
)
async function updatePreparationPreview() {
  if (
    !selected.value ||
    !Number.isInteger(preparation.outputQty) ||
    preparation.outputQty <= 0 ||
    preparation.lossQty < 0
  ) {
    preparationPlan.value = null
    return
  }
  try {
    preparationPlan.value = await previewPreparation(selected.value.id, {
      outputQty: preparation.outputQty,
      lossQty: preparation.lossQty,
      allocations: preparationOverride.value
    })
  } catch (cause) {
    preparationPlan.value = null
    emit('flash', message(cause), true)
  }
}
async function submitPreparation() {
  if (!selected.value || !preparationPlan.value)
    return emit('flash', '请先填写数量并等待批次推荐', true)
  const target = selected.value.id
  const payload = {
    ...preparation,
    allocations: preparationPlan.value.allocations.map((row) => ({
      sourceBatchId: row.sourceBatchId,
      quantity: row.quantity
    }))
  }
  const clientRequestId = mutationId('MATERIAL_PREPARE', target, payload)
  busy.value = true
  try {
    const result = await prepareMaterial(target, { ...payload, clientRequestId })
    clearMutation('MATERIAL_PREPARE', target)
    emit(
      'flash',
      result.reused ? '分装结果已恢复，没有重复扣料' : `分装完成，批次 ${result.batchNo}`
    )
    modal.value = ''
    await refresh()
  } catch (cause) {
    clearMutation('MATERIAL_PREPARE', target, cause)
    emit('flash', message(cause), true)
  } finally {
    busy.value = false
  }
}
function openAssembly() {
  Object.assign(assembly, { skuId: '', quantity: 0, boxCode: '', location: '', note: '' })
  assemblyPlan.value = null
  Object.keys(assemblyOverrides).forEach((key) => delete assemblyOverrides[key])
  modal.value = 'assemble'
}
let assemblyTimer: number | undefined
watch(
  () => [assembly.skuId, assembly.quantity],
  () => {
    Object.keys(assemblyOverrides).forEach((key) => delete assemblyOverrides[key])
    window.clearTimeout(assemblyTimer)
    assemblyTimer = window.setTimeout(() => void updateAssemblyPreview(), 180)
  }
)
async function updateAssemblyPreview() {
  if (!assembly.skuId || !Number.isInteger(assembly.quantity) || assembly.quantity <= 0) {
    assemblyPlan.value = null
    return
  }
  try {
    const allocations = Object.entries(assemblyOverrides).map(([materialId, rows]) => ({
      materialId,
      allocations: rows
    }))
    assemblyPlan.value = await previewKitAssembly({
      skuId: assembly.skuId,
      quantity: assembly.quantity,
      allocations
    })
  } catch (cause) {
    assemblyPlan.value = null
    emit('flash', message(cause), true)
  }
}
async function submitAssembly() {
  if (!assemblyPlan.value) return emit('flash', '请选择 SKU、数量并等待批次推荐', true)
  const target = assembly.skuId
  const sku = props.inventory.find((row) => row.skuId === target)
  if (
    !window.confirm(
      `确认入库 ${assembly.quantity} 套「${sku ? `${sku.modelName} · ${sku.skuName}` : '所选 SKU'}」？\n系统会按照材料清单同步扣除零件。`
    )
  )
    return
  const payload = {
    ...assembly,
    allocations: assemblyPlan.value.plan.map((row) => ({
      materialId: row.materialId,
      allocations: row.allocations.map((lot) => ({
        sourceBatchId: lot.sourceBatchId,
        quantity: lot.quantity
      }))
    }))
  }
  const clientRequestId = mutationId('KIT_ASSEMBLE', target, payload)
  busy.value = true
  try {
    const result = await assembleKit({ ...payload, clientRequestId })
    clearMutation('KIT_ASSEMBLE', target)
    emit(
      'flash',
      result.reused
        ? '组装结果已恢复，没有重复扣料或入库'
        : `材料包入库完成，批次 ${result.batchNo}`
    )
    modal.value = ''
    await Promise.all([refresh(), Promise.resolve(emit('inventoryChanged'))])
  } catch (cause) {
    clearMutation('KIT_ASSEMBLE', target, cause)
    emit('flash', message(cause), true)
  } finally {
    busy.value = false
  }
}
async function openAllocation(mode: 'prepare' | 'kit', plan: MaterialPlan) {
  try {
    const data = await loadMaterialLots(plan.materialId)
    lotMaterial.value = data.material
    lots.value = data.lots.filter((row) => row.status === 'AVAILABLE' && row.availableQty > 0)
    allocation.mode = mode
    allocation.materialId = plan.materialId
    allocation.requiredQty = plan.requiredQty
    allocation.unit = plan.unit
    allocation.name = plan.materialName
    allocation.values = Object.fromEntries(
      plan.allocations.map((row) => [row.sourceBatchId, row.quantity])
    )
    modal.value = 'allocation'
  } catch (cause) {
    emit('flash', message(cause), true)
  }
}
const allocationTotal = computed(() =>
  Object.values(allocation.values).reduce((sum, value) => sum + Number(value || 0), 0)
)
const modalTitle = computed(
  () =>
    (
      ({
        detail: selected.value?.name || '物品详情',
        lots: `${selected.value?.name || ''} · 批次列表`,
        restock: '零件实收入库',
        prepare: '零件分装',
        assemble: '材料包入库',
        allocation: '更换来源批次',
        definition: definition.id
          ? '编辑零件'
          : props.mode === 'PACKED'
            ? '新增分装小包'
            : '新增基础零件',
        defect: '登记报损',
        adjust: '盘点调整'
      }) as Record<string, string>
    )[modal.value] || '库存操作'
)
async function confirmAllocation() {
  if (allocationTotal.value !== allocation.requiredQty)
    return emit('flash', `所选批次数量合计必须为 ${allocation.requiredQty}`, true)
  const rows = Object.entries(allocation.values)
    .filter(([, quantity]) => quantity > 0)
    .map(([sourceBatchId, quantity]) => ({ sourceBatchId, quantity }))
  if (allocation.mode === 'prepare') {
    preparationOverride.value = rows
    modal.value = 'prepare'
    await updatePreparationPreview()
  } else {
    assemblyOverrides[allocation.materialId] = rows
    modal.value = 'assemble'
    await updateAssemblyPreview()
  }
}

const sourceMaterials = computed(() =>
  items.value.filter((item) => item.itemType !== 'PACKED' && item.id !== definition.id)
)
async function loadOptions() {
  const data = await loadMaterialFormOptions(definition.itemType === 'PACKED' ? 'PACKED' : 'RAW')
  formOptions.names = data.names
  formOptions.units = data.units
}
async function openDefinition(item?: MaterialItem) {
  selected.value = item || null
  Object.assign(
    definition,
    item
      ? {
          id: item.id,
          name: item.name,
          itemType: item.itemType,
          specification: item.specification || '',
          unit: item.unit,
          safetyStock: item.safetyStock,
          leadTime: item.leadTime,
          note: item.note || '',
          sourceMaterialId: item.sourceMaterialId || '',
          sourceQtyPerUnit: item.sourceQtyPerUnit || 0
        }
      : {
          id: '',
          name: '',
          itemType: props.mode === 'PACKED' ? 'PACKED' : 'RAW',
          specification: '',
          unit: '个',
          safetyStock: 10,
          leadTime: 7,
          note: '',
          sourceMaterialId: '',
          sourceQtyPerUnit: 0
        }
  )
  newOption.name = ''
  newOption.unit = ''
  modal.value = 'definition'
  try {
    await loadOptions()
  } catch (cause) {
    emit('flash', message(cause), true)
  }
}
async function addOption(kind: 'name' | 'unit') {
  const value = newOption[kind].trim()
  if (!value) return emit('flash', kind === 'name' ? '请输入新名称' : '请输入新单位', true)
  try {
    await addMaterialFormOption({
      category: kind === 'name' ? 'NAME' : 'UNIT',
      scope: definition.itemType === 'PACKED' ? 'PACKED' : 'RAW',
      value
    })
    newOption[kind] = ''
    await loadOptions()
    if (kind === 'name') definition.name = value
    else definition.unit = value
  } catch (cause) {
    emit('flash', message(cause), true)
  }
}
async function removeOption(kind: 'name' | 'unit', option: MaterialFormOption) {
  try {
    await removeMaterialFormOption(option.id)
    if (kind === 'name' && definition.name === option.value) definition.name = ''
    if (kind === 'unit' && definition.unit === option.value) definition.unit = ''
    await loadOptions()
    emit('flash', '选项已删除，已有零件和库存不受影响')
  } catch (cause) {
    emit('flash', message(cause), true)
  }
}
async function submitDefinition() {
  if (!definition.name.trim()) return emit('flash', '请选择零件名称', true)
  if (!definition.unit.trim()) return emit('flash', '请选择单位', true)
  if (
    definition.safetyStock < 0 ||
    !Number.isInteger(definition.leadTime) ||
    definition.leadTime < 1
  )
    return emit('flash', '请检查安全库存线和采购周期', true)
  if (
    definition.itemType === 'PACKED' &&
    (!definition.sourceMaterialId ||
      !Number.isInteger(definition.sourceQtyPerUnit) ||
      definition.sourceQtyPerUnit <= 0)
  )
    return emit('flash', '请选择分装来源并填写每包用量', true)
  const payload = {
    name: definition.name.trim(),
    itemType: definition.itemType,
    specification: definition.specification.trim() || undefined,
    unit: definition.unit.trim(),
    safetyStock: definition.safetyStock,
    leadTime: definition.leadTime,
    note: definition.note.trim() || undefined,
    sourceMaterialId: definition.itemType === 'PACKED' ? definition.sourceMaterialId : undefined,
    sourceQtyPerUnit: definition.itemType === 'PACKED' ? definition.sourceQtyPerUnit : undefined
  }
  busy.value = true
  try {
    if (definition.id) {
      await updateMaterial(definition.id, payload)
      emit('flash', '零件资料已保存')
    } else {
      const target = 'material-definition'
      const clientRequestId = mutationId('MATERIAL_CREATE', target, payload)
      const result = await createMaterial({ ...payload, clientRequestId })
      clearMutation('MATERIAL_CREATE', target)
      emit('flash', result.reused ? '创建结果已恢复，没有生成重复零件' : '零件已创建')
    }
    modal.value = ''
    await refresh()
  } catch (cause) {
    if (!definition.id) clearMutation('MATERIAL_CREATE', 'material-definition', cause)
    emit('flash', message(cause), true)
  } finally {
    busy.value = false
  }
}
function openStockChange(item: MaterialItem, mode: 'defect' | 'adjust') {
  selected.value = item
  stockChange.quantity = 0
  stockChange.note = ''
  modal.value = mode
}
async function submitStockChange() {
  if (!selected.value) return
  const id = selected.value.id,
    mode = modal.value
  if (!Number.isInteger(stockChange.quantity) || stockChange.quantity === 0)
    return emit('flash', mode === 'defect' ? '报损数量必须为正整数' : '调整量必须为非零整数', true)
  if (mode === 'defect' && stockChange.quantity < 1)
    return emit('flash', '报损数量必须为正整数', true)
  if (!stockChange.note.trim())
    return emit('flash', mode === 'defect' ? '报损原因不能为空' : '盘点调整必须填写原因', true)
  const action = mode === 'defect' ? 'MATERIAL_DEFECT' : 'MATERIAL_ADJUST'
  const payload =
    mode === 'defect'
      ? { quantity: stockChange.quantity, note: stockChange.note.trim() }
      : { delta: stockChange.quantity, note: stockChange.note.trim() }
  const clientRequestId = mutationId(action, id, payload)
  busy.value = true
  try {
    const result =
      mode === 'defect'
        ? await defectMaterial(id, {
            quantity: stockChange.quantity,
            note: stockChange.note.trim(),
            clientRequestId
          })
        : await adjustMaterial(id, {
            delta: stockChange.quantity,
            note: stockChange.note.trim(),
            clientRequestId
          })
    clearMutation(action, id)
    emit(
      'flash',
      result.reused
        ? '操作结果已恢复，没有重复改变库存'
        : mode === 'defect'
          ? '报损已登记'
          : '盘点调整已保存'
    )
    modal.value = ''
    await refresh()
  } catch (cause) {
    clearMutation(action, id, cause)
    emit('flash', message(cause), true)
  } finally {
    busy.value = false
  }
}

defineExpose({ refresh, openAssembly })
watch(
  () => props.mode,
  () => void refresh(),
  { immediate: true }
)
</script>

<template>
  <section class="material-panel">
    <div class="toolbar">
      <div v-if="mode === 'PACKED'" class="filter-tabs">
        <button
          v-for="option in filterOptions"
          :key="option.value"
          class="filter-tab"
          :class="{ active: filter === option.value }"
          @click="filter = option.value"
        >
          {{ option.label }}
        </button>
      </div>
      <p v-else class="material-help">
        采购到货先在这里清点合格数量；每个到货批次独立保存，分装时由系统优先使用最早批次。
      </p>
      <div class="material-toolbar-actions">
        <button class="btn btn-black" type="button" @click="openDefinition()">
          ＋ {{ mode === 'PACKED' ? '新增分装小包' : '新增基础零件' }}
        </button>
        <button v-if="mode === 'PACKED'" class="btn" type="button" @click="openAssembly">
          材料包入库
        </button>
      </div>
    </div>
    <div v-if="loading" class="empty">正在加载…</div>
    <div v-else-if="!shown.length" class="empty">🧩 暂无物品</div>
    <div v-else class="material-grid">
      <article v-for="item in shown" :key="item.id" class="material-card">
        <div class="material-card-head">
          <div>
            <h3>{{ item.name }}</h3>
            <p>{{ typeLabel(item) }} · {{ item.itemCode || '自动编码' }} · 单位：{{ item.unit }}</p>
            <p v-if="item.specification">{{ item.specification }}</p>
          </div>
          <strong :class="item.alertLevel.toLowerCase()"
            >{{ item.currentStock }}<small>{{ item.unit }}</small></strong
          >
        </div>
        <div class="material-tags">
          <span class="badge" :class="item.alertLevel.toLowerCase()">{{
            alertText[item.alertLevel]
          }}</span
          ><span>安全线 {{ item.safetyStock }}</span
          ><span>补货周期 {{ item.leadTime }}天</span
          ><span v-if="item.boundSkuCount">绑定 {{ item.boundSkuCount }} 个 SKU</span>
        </div>
        <p class="material-consumption">
          日均消耗 {{ item.dailyConsumption || 0 }} {{ item.unit }}，{{
            item.availableDays === null ? '无消耗数据' : `约${item.availableDays}天可用`
          }}
        </p>
        <div class="material-actions">
          <button
            v-if="item.itemType === 'PACKED'"
            class="btn btn-sm good"
            @click="openPrepare(item)"
          >
            分装</button
          ><button v-else class="btn btn-sm good" @click="openRestock(item)">采购入库</button
          ><button class="btn btn-sm" @click="openLots(item)">批次</button
          ><button class="btn btn-sm" @click="openDetail(item)">详情</button
          ><button class="btn btn-sm danger" @click="openStockChange(item, 'defect')">报损</button
          ><button class="btn btn-sm" @click="openStockChange(item, 'adjust')">盘点</button
          ><button class="btn btn-sm" @click="openDefinition(item)">编辑</button>
        </div>
      </article>
    </div>
  </section>

  <div v-if="modal" class="material-modal-overlay" @click.self="modal = ''">
    <section
      class="material-modal"
      :class="{ wide: ['detail', 'lots', 'assemble', 'allocation'].includes(modal) }"
    >
      <header>
        <div>
          <h2>{{ modalTitle }}</h2>
          <p v-if="modal === 'restock'">{{ selected?.name }} · 库存单位：{{ selected?.unit }}</p>
        </div>
        <button :disabled="busy" @click="modal = ''">×</button>
      </header>
      <template v-if="modal === 'detail' && selected">
        <div class="material-state">
          <strong :class="selected.alertLevel.toLowerCase()">{{ selected.currentStock }}</strong>
          <div>
            <b>{{ alertText[selected.alertLevel] }}</b>
            <p>安全库存线：{{ selected.safetyStock }} {{ selected.unit }}</p>
            <p>
              补货周期：{{ selected.leadTime }} 天 · 日均消耗：{{ selected.dailyConsumption || 0 }}
            </p>
          </div>
        </div>
        <h3>用于哪些 SKU</h3>
        <p v-if="!bindings.length" class="empty compact">暂未被任何 SKU 的材料清单使用</p>
        <div v-for="binding in bindings" v-else :key="binding.id" class="binding-row">
          <span
            ><b>{{ binding.modelName }}</b
            ><small>{{ binding.skuSpec }}</small></span
          ><strong>每套使用 {{ binding.qtyPerUnit }} {{ selected.unit }}</strong>
        </div>
        <RouterLink class="btn" to="/admin/models">前往款式管理设置材料清单</RouterLink>
        <h3>变动记录</h3>
        <p v-if="!logs.length" class="empty compact">暂无记录</p>
        <div v-for="log in logs" v-else :key="log.id" class="material-log">
          <span>{{ formatTime(log.createdAt) }}</span
          ><b>{{ logText[log.type] || log.type }}</b
          ><strong>{{ log.quantity }}</strong
          ><span>{{ log.note || log.referenceNo || '—' }}</span>
        </div>
      </template>
      <template v-else-if="modal === 'lots' && lotMaterial">
        <div v-if="lotDetail" class="lot-detail">
          <button class="btn btn-sm" @click="lotDetail = null">← 返回批次列表</button>
          <h3>批次 {{ lotDetail.batchNo || lotDetail.receiptNo }}</h3>
          <p><b>状态：</b>{{ lotDetail.status || '历史记录' }}</p>
          <p><b>原始/产出数量：</b>{{ lotDetail.outputQty ?? lotDetail.acceptedQty ?? '—' }}</p>
          <p><b>当前剩余：</b>{{ lotDetail.availableQty }}</p>
          <p><b>存放位置：</b>{{ lotDetail.location || '未填写' }}</p>
          <p v-if="lotDetail.supplierName"><b>供应商：</b>{{ lotDetail.supplierName }}</p>
          <p v-if="lotDetail.supplierLotNo"><b>供应商批号：</b>{{ lotDetail.supplierLotNo }}</p>
          <p v-if="lotDetail.inputs?.length">
            <b>来源：</b
            >{{
              lotDetail.inputs
                .map(
                  (row) =>
                    `${row.sourceBatchNo || row.sourceReceiptId || '旧记录未标明批次'}（使用${row.usedQty}，损耗${row.lossQty}）`
                )
                .join('；')
            }}
          </p>
          <p><b>建立时间：</b>{{ formatTime(lotDetail.createdAt) }}</p>
          <p><b>备注：</b>{{ lotDetail.note || '无' }}</p>
        </div>
        <div v-else>
          <p v-if="!lots.length" class="empty">暂无批次记录</p>
          <button v-for="lot in lots" v-else :key="lot.id" class="lot-row" @click="inspectLot(lot)">
            <span>{{ lot.batchNo || lot.receiptNo }}</span
            ><span>剩余 {{ lot.availableQty }} {{ lotMaterial.unit }} · {{ lot.status }}</span>
          </button>
        </div>
      </template>
      <form v-else-if="modal === 'definition'" @submit.prevent="submitDefinition">
        <label>零件名称 *</label>
        <div class="managed-field">
          <select v-model="definition.name" aria-label="零件名称">
            <option value="">请选择零件名称</option>
            <option
              v-if="
                definition.name &&
                !formOptions.names.some((option) => option.value === definition.name)
              "
              :value="definition.name"
            >
              {{ definition.name }}（历史值）
            </option>
            <option v-for="option in formOptions.names" :key="option.id" :value="option.value">
              {{ option.value }}
            </option>
          </select>
          <div class="managed-options">
            <span v-for="option in formOptions.names" :key="option.id"
              >{{ option.value
              }}<button
                type="button"
                :aria-label="`删除名称 ${option.value}`"
                @click="removeOption('name', option)"
              >
                ×
              </button></span
            >
          </div>
          <div class="managed-add">
            <input
              v-model.trim="newOption.name"
              aria-label="新增名称"
              maxlength="100"
              placeholder="新增名称"
            /><button class="btn" type="button" @click="addOption('name')">＋</button>
          </div>
        </div>
        <label
          >规格<input
            v-model.trim="definition.specification"
            placeholder="如：长度5.5cm、椴木5×5cm"
        /></label>
        <div v-if="definition.itemType === 'PACKED'" class="packed-definition">
          <div class="form-pair">
            <label
              >分装来源 *<select v-model="definition.sourceMaterialId" aria-label="分装来源">
                <option value="">请选择来源零件</option>
                <option v-for="item in sourceMaterials" :key="item.id" :value="item.id">
                  {{ item.name }}（{{ item.currentStock }}{{ item.unit }}）
                </option>
              </select></label
            ><label
              >每包使用来源数量 *<input
                v-model.number="definition.sourceQtyPerUnit"
                type="number"
                min="1"
                step="1"
            /></label>
          </div>
        </div>
        <label>单位 *</label>
        <div class="managed-field">
          <select v-model="definition.unit" aria-label="单位">
            <option value="">请选择单位</option>
            <option
              v-if="
                definition.unit &&
                !formOptions.units.some((option) => option.value === definition.unit)
              "
              :value="definition.unit"
            >
              {{ definition.unit }}（历史值）
            </option>
            <option v-for="option in formOptions.units" :key="option.id" :value="option.value">
              {{ option.value }}
            </option>
          </select>
          <div class="managed-options">
            <span v-for="option in formOptions.units" :key="option.id"
              >{{ option.value
              }}<button
                type="button"
                :aria-label="`删除单位 ${option.value}`"
                @click="removeOption('unit', option)"
              >
                ×
              </button></span
            >
          </div>
          <div class="managed-add">
            <input
              v-model.trim="newOption.unit"
              aria-label="新增单位"
              maxlength="100"
              placeholder="新增单位"
            /><button class="btn" type="button" @click="addOption('unit')">＋</button>
          </div>
        </div>
        <div class="form-pair">
          <label
            >安全库存线<input
              v-model.number="definition.safetyStock"
              type="number"
              min="0" /></label
          ><label
            >采购周期（天）<input
              v-model.number="definition.leadTime"
              type="number"
              min="1"
              step="1"
          /></label>
        </div>
        <label
          >备注<input v-model.trim="definition.note" placeholder="供应商名称、规格说明等"
        /></label>
        <footer>
          <button class="btn" type="button" @click="modal = ''">取消</button
          ><button class="btn btn-black" :disabled="busy">保存</button>
        </footer>
      </form>
      <form
        v-else-if="(modal === 'defect' || modal === 'adjust') && selected"
        @submit.prevent="submitStockChange"
      >
        <p class="modal-note">
          {{ selected.name }} · 当前库存 {{ selected.currentStock }} {{ selected.unit }}
        </p>
        <label
          >{{ modal === 'defect' ? '报损数量 *' : '调整量 *'
          }}<input
            v-model.number="stockChange.quantity"
            type="number"
            step="1"
            :min="modal === 'defect' ? 1 : undefined"
            :placeholder="modal === 'adjust' ? '正数增加，负数调减' : ''"
        /></label>
        <label
          >{{ modal === 'defect' ? '报损原因 *' : '调整原因 *'
          }}<input v-model.trim="stockChange.note" maxlength="200"
        /></label>
        <footer>
          <button class="btn" type="button" @click="modal = ''">取消</button
          ><button class="btn btn-black" :disabled="busy">确认</button>
        </footer>
      </form>
      <form v-else-if="modal === 'restock'" @submit.prevent="submitRestock">
        <label
          >订购说明<input v-model.trim="receipt.orderedSpec" placeholder="如：50米，工厂切成5.5cm"
        /></label>
        <div class="form-pair">
          <label
            >实际合格数量 *<input
              v-model.number="receipt.acceptedQty"
              type="number"
              min="1"
              step="1" /></label
          ><label
            >到货次品数量<input v-model.number="receipt.rejectedQty" type="number" min="0" step="1"
          /></label>
        </div>
        <div class="form-pair">
          <label>供应商<input v-model.trim="receipt.supplierName" /></label
          ><label>供应商批号<input v-model.trim="receipt.supplierLotNo" /></label>
        </div>
        <label>存放位置<input v-model.trim="receipt.location" placeholder="如 A区-01箱" /></label
        ><label>备注<input v-model.trim="receipt.note" /></label>
        <footer>
          <button class="btn" type="button" @click="modal = ''">取消</button
          ><button class="btn btn-black" :disabled="busy">确认入库</button>
        </footer>
      </form>
      <form v-else-if="modal === 'prepare' && selected" @submit.prevent="submitPreparation">
        <p class="modal-note">
          {{ selected.name }}：每{{ selected.unit }}使用 {{ selected.sourceQtyPerUnit }}
          {{ selected.sourceMaterialName || '来源零件' }}
        </p>
        <div class="form-pair">
          <label
            >分装成品数量 *<input
              v-model.number="preparation.outputQty"
              type="number"
              min="1"
              step="1" /></label
          ><label
            >本次额外损耗<input v-model.number="preparation.lossQty" type="number" min="0" step="1"
          /></label>
        </div>
        <div class="plan-box">
          <template v-if="preparationPlan"
            >扣除 {{ preparationPlan.requiredQty }} {{ preparationPlan.unit }}
            {{ preparationPlan.materialName }}，增加 {{ preparation.outputQty }} {{ selected.unit }}
            {{ selected.name }}
            <div class="allocation-chips">
              <span v-for="row in preparationPlan.allocations" :key="row.sourceBatchId"
                >{{ row.batchNo }}：{{ row.quantity }}{{ preparationPlan.unit }}</span
              >
            </div>
            <button
              class="btn btn-sm"
              type="button"
              @click="openAllocation('prepare', preparationPlan)"
            >
              特殊情况更换批次
            </button></template
          ><span v-else>填写分装数量后，系统会按先进先出推荐具体来源批次。</span>
        </div>
        <label>成品小包存放位置<input v-model.trim="preparation.location" /></label
        ><label>备注<input v-model.trim="preparation.note" /></label>
        <footer>
          <button class="btn" type="button" @click="modal = ''">取消</button
          ><button class="btn btn-black" :disabled="busy || !preparationPlan">确认分装</button>
        </footer>
      </form>
      <form v-else-if="modal === 'assemble'" @submit.prevent="submitAssembly">
        <p class="modal-note">选择 SKU 和数量，系统按材料清单同步扣除零件。</p>
        <label
          >材料包 SKU *<select v-model="assembly.skuId">
            <option value="">请选择 SKU</option>
            <option v-for="row in inventory" :key="row.skuId" :value="row.skuId">
              {{ row.modelName }} · {{ row.skuName }} · {{ row.skuCode || row.skuBarcode }}
            </option>
          </select></label
        >
        <div class="form-pair">
          <label
            >入库套数 *<input
              v-model.number="assembly.quantity"
              type="number"
              min="1"
              step="1" /></label
          ><label
            >箱码（选填，可重复使用）<input v-model.trim="assembly.boxCode" placeholder="如 BX-008"
          /></label>
        </div>
        <label>库位（选填）<input v-model.trim="assembly.location" /></label>
        <div class="plan-box">
          <template v-if="assemblyPlan"
            ><div v-for="plan in assemblyPlan.plan" :key="plan.materialId" class="kit-plan">
              <b>{{ plan.materialName }}：需要 {{ plan.requiredQty }}{{ plan.unit }}</b>
              <div class="allocation-chips">
                <span v-for="row in plan.allocations" :key="row.sourceBatchId"
                  >{{ row.batchNo }}：{{ row.quantity }}{{ plan.unit }}</span
                >
              </div>
              <button class="btn btn-sm" type="button" @click="openAllocation('kit', plan)">
                特殊情况更换批次
              </button>
            </div></template
          ><span v-else>选择 SKU 和数量后显示系统推荐批次</span>
        </div>
        <label>备注<input v-model.trim="assembly.note" /></label>
        <footer>
          <button class="btn" type="button" @click="modal = ''">取消</button
          ><button class="btn btn-black" :disabled="busy || !assemblyPlan">确认材料包入库</button>
        </footer>
      </form>
      <template v-else-if="modal === 'allocation'"
        ><p class="modal-note">
          {{ allocation.name }}：本次合计需要 {{ allocation.requiredQty }}
          {{ allocation.unit }}。系统默认先进先出，仅在实物批次不适用时改选。
        </p>
        <div v-for="lot in lots" :key="lot.id" class="allocation-row">
          <b>{{ lot.batchNo || lot.receiptNo }}</b
          ><span
            >剩余 {{ lot.availableQty }}{{ allocation.unit
            }}{{ lot.location ? ` · ${lot.location}` : '' }}</span
          ><input
            v-model.number="allocation.values[lot.id]"
            type="number"
            min="0"
            :max="lot.availableQty"
            step="1"
          />
        </div>
        <p class="allocation-total" :class="{ valid: allocationTotal === allocation.requiredQty }">
          已选择 {{ allocationTotal }} / 需要 {{ allocation.requiredQty }}
        </p>
        <footer>
          <button
            class="btn"
            @click="modal = allocation.mode === 'prepare' ? 'prepare' : 'assemble'"
          >
            取消</button
          ><button class="btn btn-black" @click="confirmAllocation">确认改选</button>
        </footer></template
      >
    </section>
  </div>
</template>
