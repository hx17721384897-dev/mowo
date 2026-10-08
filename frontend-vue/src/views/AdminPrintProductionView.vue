<script setup lang="ts">
/* eslint-disable vue/html-closing-bracket-newline, vue/html-indent, vue/multiline-html-element-content-newline */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import AdminSidebar from '@/components/AdminSidebar.vue'
import { safeImageUrl } from '@/shared/media/safe-image-url'
import {
  addPrintRules,
  loadPrintConfig,
  movePrintRule,
  removePrintRule,
  reorderPrintGroups,
  reorderPrintRules,
  savePrintGroup,
  uploadPrintTemplate,
  type GroupInput,
  type PrintGroup,
  type PrintRule,
  type PrintSku
} from '@/features/admin-print-production/api'
import './admin-print-production.css'

type DragState =
  { type: 'group'; id: string } | { type: 'sku'; skuId: string; ruleId: string | null } | null

const mobileOpen = ref(false),
  collapsed = ref(false),
  loading = ref(true),
  busy = ref(false)
const groups = ref<PrintGroup[]>([]),
  skus = ref<PrintSku[]>([]),
  notice = ref('')
const groupOpen = ref(false),
  templateOpen = ref(false),
  skuOpen = ref(false)
const editingGroupId = ref<string | null>(null),
  templateGroupId = ref(''),
  ruleGroupId = ref('')
const pickedSkuIds = ref<string[]>([]),
  templateFile = ref<File | null>(null),
  dragState = ref<DragState>(null),
  dragOver = ref('')
const filters = reactive({ search: '', frame: '', material: '', color: '' })
const groupForm = reactive<GroupInput>({
  name: '',
  size: '',
  framesPerSheet: 0,
  paperSize: 'A4',
  paperType: '普通打印纸',
  orientation: 'LANDSCAPE',
  renderDpi: 600,
  frameWidthMm: 0,
  frameHeightMm: 0,
  separatorMicrons: 460,
  cuttingTool: ''
})
const mutationStorageKey = 'mowo.printConfig.pendingMutations'
let noticeTimer: number | undefined,
  loadSequence = 0

const skuMap = computed(() => new Map(skus.value.map((sku) => [sku.id, sku])))
const assignedIds = computed(
  () => new Set(groups.value.flatMap((group) => group.rules.map((rule) => rule.skuId)))
)
const unassigned = computed(() => skus.value.filter((sku) => !assignedIds.value.has(sku.id)))
const activeGroup = computed(
  () => groups.value.find((group) => group.id === ruleGroupId.value) || null
)
const available = computed(() =>
  skus.value.filter((sku) => sku.size === activeGroup.value?.size && !sku.assignment)
)
const pickerRows = computed(() => {
  const query = filters.search.trim().toLowerCase()
  return available.value.filter(
    (sku) =>
      (!query || `${sku.modelName} ${sku.skuCode || ''}`.toLowerCase().includes(query)) &&
      (!filters.frame || String(sku.frameCount) === filters.frame) &&
      (!filters.material || sku.material === filters.material) &&
      (!filters.color || sku.colorName === filters.color)
  )
})
const pickerFrames = computed(() =>
  [...new Set(available.value.map((sku) => sku.frameCount))].sort((a, b) => a - b)
)
const pickerMaterials = computed(() => [...new Set(available.value.map((sku) => sku.material))])
const pickerColors = computed(() => [...new Set(available.value.map((sku) => sku.colorName))])
const sizeOptions = computed(() => {
  const current = groups.value.find((group) => group.id === editingGroupId.value)?.size
  return [...new Set([...skus.value.map((sku) => sku.size), ...(current ? [current] : [])])]
})
const stats = computed(() => ({
  groups: groups.value.filter((group) => group.isActive).length,
  configured: skus.value.length - unassigned.value.length,
  unassigned: unassigned.value.length
}))
const templateGroup = computed(
  () => groups.value.find((group) => group.id === templateGroupId.value) || null
)

function flash(message: string) {
  notice.value = message
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => (notice.value = ''), 2500)
}
function message(error: unknown) {
  return error instanceof Error ? error.message : '操作失败'
}
async function loadData() {
  const sequence = ++loadSequence
  loading.value = true
  try {
    const result = await loadPrintConfig()
    if (sequence !== loadSequence) return
    groups.value = result.groups || []
    skus.value = result.skus || []
  } catch (error) {
    flash(message(error))
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}
function storedRequest(scope: string, signature: string) {
  try {
    const rows = JSON.parse(sessionStorage.getItem(mutationStorageKey) || '{}') as Record<
      string,
      { signature: string; id: string }
    >
    if (rows[scope]?.signature === signature) return rows[scope].id
    const id = `print-${scope}-${crypto.randomUUID()}`.slice(0, 80)
    rows[scope] = { signature, id }
    sessionStorage.setItem(mutationStorageKey, JSON.stringify(rows))
    return id
  } catch {
    return `print-${scope}-${crypto.randomUUID()}`.slice(0, 80)
  }
}
function clearRequest(scope: string) {
  try {
    const rows = JSON.parse(sessionStorage.getItem(mutationStorageKey) || '{}') as Record<
      string,
      unknown
    >
    delete rows[scope]
    sessionStorage.setItem(mutationStorageKey, JSON.stringify(rows))
  } catch {
    // Storage failure must not turn a successful server write into a second write in this click.
  }
}
function openGroup(group?: PrintGroup) {
  editingGroupId.value = group?.id || null
  Object.assign(groupForm, {
    name: group?.name || '',
    size: group?.size || sizeOptions.value[0] || '',
    framesPerSheet: group?.framesPerSheet || 0,
    paperSize: group?.paperSize || 'A4',
    paperType: group?.paperType || '普通打印纸',
    orientation: group?.orientation || 'LANDSCAPE',
    renderDpi: group?.renderDpi || 600,
    frameWidthMm: group?.frameWidthMm || 0,
    frameHeightMm: group?.frameHeightMm || 0,
    separatorMicrons: group?.separatorMicrons || 460,
    cuttingTool: group?.cuttingTool || ''
  })
  groupOpen.value = true
}
function groupPayload(): GroupInput {
  return {
    name: groupForm.name,
    size: groupForm.size,
    framesPerSheet: Number(groupForm.framesPerSheet),
    paperSize: groupForm.paperSize,
    paperType: groupForm.paperType,
    orientation: groupForm.orientation,
    renderDpi: Number(groupForm.renderDpi),
    frameWidthMm: Number(groupForm.frameWidthMm),
    frameHeightMm: Number(groupForm.frameHeightMm),
    separatorMicrons: Number(groupForm.separatorMicrons),
    cuttingTool: groupForm.cuttingTool
  }
}
async function submitGroup() {
  if (busy.value) return
  busy.value = true
  const input = groupPayload()
  const scope = 'group-create'
  if (!editingGroupId.value) input.clientRequestId = storedRequest(scope, JSON.stringify(input))
  try {
    const result = await savePrintGroup(editingGroupId.value, input)
    if (!editingGroupId.value) clearRequest(scope)
    groupOpen.value = false
    flash(result.reused ? '已恢复此前创建成功的打印裁切组' : '已保存')
    await loadData()
  } catch (error) {
    flash(message(error))
  } finally {
    busy.value = false
  }
}
async function toggleGroup(group: PrintGroup) {
  if (busy.value) return
  busy.value = true
  try {
    await savePrintGroup(group.id, {
      name: group.name,
      size: group.size,
      framesPerSheet: group.framesPerSheet,
      paperSize: group.paperSize,
      paperType: group.paperType,
      orientation: group.orientation,
      renderDpi: group.renderDpi,
      frameWidthMm: group.frameWidthMm || 0,
      frameHeightMm: group.frameHeightMm || 0,
      separatorMicrons: group.separatorMicrons,
      cuttingTool: group.cuttingTool || '',
      isActive: !group.isActive
    })
    await loadData()
  } catch (error) {
    flash(message(error))
  } finally {
    busy.value = false
  }
}
function openTemplate(group: PrintGroup) {
  templateGroupId.value = group.id
  templateFile.value = null
  templateOpen.value = true
}
function chooseTemplate(event: Event) {
  templateFile.value = (event.target as HTMLInputElement).files?.[0] || null
}
async function submitTemplate() {
  const file = templateFile.value
  if (!file) return flash('请选择 .docx 模板')
  const scope = `template-${templateGroupId.value}`
  const id = storedRequest(scope, `${file.name}:${file.size}:${file.lastModified}`)
  busy.value = true
  try {
    const result = await uploadPrintTemplate(templateGroupId.value, file, id)
    clearRequest(scope)
    templateOpen.value = false
    flash(result.reused ? `已恢复模板 V${result.versionNo}` : `模板 V${result.versionNo} 已启用`)
    await loadData()
  } catch (error) {
    flash(message(error))
  } finally {
    busy.value = false
  }
}
function openSku(group: PrintGroup) {
  ruleGroupId.value = group.id
  pickedSkuIds.value = []
  Object.assign(filters, { search: '', frame: '', material: '', color: '' })
  skuOpen.value = true
}
function setPicked(id: string, checked: boolean) {
  pickedSkuIds.value = checked
    ? [...new Set([...pickedSkuIds.value, id])]
    : pickedSkuIds.value.filter((value) => value !== id)
}
function toggleAll(checked: boolean) {
  const ids = pickerRows.value.map((sku) => sku.id)
  pickedSkuIds.value = checked
    ? [...new Set([...pickedSkuIds.value, ...ids])]
    : pickedSkuIds.value.filter((id) => !ids.includes(id))
}
async function submitRules() {
  if (!pickedSkuIds.value.length) return flash('请至少选择一个 SKU')
  busy.value = true
  try {
    await addPrintRules(ruleGroupId.value, pickedSkuIds.value)
    skuOpen.value = false
    flash('SKU已添加')
    await loadData()
  } catch (error) {
    flash(message(error))
  } finally {
    busy.value = false
  }
}
async function removeRule(rule: PrintRule) {
  if (!window.confirm('移出后，该SKU会回到“尚未配置”区域。已有生产批次不受影响。')) return
  try {
    await removePrintRule(rule.id)
    await loadData()
  } catch (error) {
    flash(message(error))
  }
}
function beginGroupDrag(event: DragEvent, id: string) {
  if ((event.target as HTMLElement).closest('button')) return event.preventDefault()
  dragState.value = { type: 'group', id }
  event.dataTransfer?.setData('text/plain', `group:${id}`)
}
function beginSkuDrag(event: DragEvent, skuId: string, ruleId: string | null) {
  event.stopPropagation()
  dragState.value = { type: 'sku', skuId, ruleId }
  event.dataTransfer?.setData('text/plain', `sku:${skuId}`)
}
function allowDrop(event: DragEvent, key: string) {
  if (!dragState.value) return
  event.preventDefault()
  event.stopPropagation()
  dragOver.value = key
}
function endDrag() {
  dragState.value = null
  dragOver.value = ''
}
async function dropOnGroup(event: DragEvent, target: PrintGroup) {
  event.preventDefault()
  event.stopPropagation()
  const state = dragState.value
  endDrag()
  if (!state) return
  try {
    if (state.type === 'group') {
      const ids = groups.value.map((group) => group.id)
      const from = ids.indexOf(state.id),
        to = ids.indexOf(target.id)
      if (from < 0 || to < 0 || from === to) return
      ids.splice(to, 0, ids.splice(from, 1)[0]!)
      await reorderPrintGroups(ids)
    } else {
      const sku = skuMap.value.get(state.skuId)
      if (!sku || sku.size !== target.size) throw new Error(`该组只接受 ${target.size} 的 SKU`)
      if (!state.ruleId) await addPrintRules(target.id, [sku.id])
      else {
        const source = groups.value.find((group) =>
          group.rules.some((rule) => rule.id === state.ruleId)
        )
        if (source?.id === target.id) {
          const ids = source.rules.map((rule) => rule.id)
          const from = ids.indexOf(state.ruleId)
          if (from >= 0) ids.push(...ids.splice(from, 1))
          await reorderPrintRules(ids)
        } else await movePrintRule(state.ruleId, target.id)
      }
    }
    await loadData()
  } catch (error) {
    flash(message(error))
  }
}
async function dropOnRule(event: DragEvent, targetGroup: PrintGroup, targetRule: PrintRule) {
  event.preventDefault()
  event.stopPropagation()
  const state = dragState.value
  endDrag()
  if (!state || state.type !== 'sku' || !state.ruleId) return
  try {
    const source = groups.value.find((group) =>
      group.rules.some((rule) => rule.id === state.ruleId)
    )
    if (!source) return
    if (source.id !== targetGroup.id) await movePrintRule(state.ruleId, targetGroup.id)
    else {
      const ids = source.rules.map((rule) => rule.id)
      const from = ids.indexOf(state.ruleId),
        to = ids.indexOf(targetRule.id)
      if (from < 0 || to < 0 || from === to) return
      ids.splice(to, 0, ids.splice(from, 1)[0]!)
      await reorderPrintRules(ids)
    }
    await loadData()
  } catch (error) {
    flash(message(error))
  }
}
async function dropUnassigned(event: DragEvent) {
  event.preventDefault()
  const state = dragState.value
  endDrag()
  if (!state || state.type !== 'sku' || !state.ruleId) return
  try {
    await removePrintRule(state.ruleId)
    await loadData()
  } catch (error) {
    flash(message(error))
  }
}
function activeTemplate(group: PrintGroup) {
  return group.templates.find((item) => item.status === 'ACTIVE')
}
function skuFor(rule: PrintRule) {
  return skuMap.value.get(rule.skuId) || rule.sku
}

onMounted(() => void loadData())
onBeforeUnmount(() => {
  loadSequence++
  window.clearTimeout(noticeTimer)
})
</script>

<template>
  <div class="admin-print-production-page">
    <div class="sidebar-backdrop" :class="{ show: mobileOpen }" @click="mobileOpen = false"></div>
    <AdminSidebar
      :mobile-open="mobileOpen"
      @mobile-close="mobileOpen = false"
      @collapse-change="collapsed = $event"
    />
    <main class="main" :class="{ expanded: collapsed }">
      <header class="topbar">
        <div class="top-actions">
          <button class="btn menu-btn" type="button" @click="mobileOpen = true">☰</button>
          <h1>打印与裁切设置</h1>
        </div>
        <button class="btn" type="button" :disabled="loading" @click="loadData">刷新</button>
      </header>
      <div class="content">
        <div class="intro">
          <div>
            <h2>生产顺序</h2>
            <p>先按打印裁切组，再按组内真实 SKU；同一 SKU 的订单按付款时间排列。</p>
          </div>
          <button class="btn btn-black" type="button" @click="openGroup()">新增打印裁切组</button>
        </div>
        <div class="summary">
          <div class="metric">
            <span>启用打印组</span><strong>{{ stats.groups }}</strong>
          </div>
          <div class="metric">
            <span>已配置 SKU</span><strong>{{ stats.configured }}</strong>
          </div>
          <div class="metric">
            <span>尚未配置 SKU</span><strong>{{ stats.unassigned }}</strong>
          </div>
        </div>
        <div class="notice">
          拖动打印组或 SKU 即可调整顺序；拖动尚未配置的 SKU
          到尺寸相同的打印组可快速加入。修改只影响之后新建的生产批次。
        </div>
        <div v-if="loading" class="empty">正在读取生产规则...</div>
        <div v-else class="group-list">
          <section
            v-for="group in groups"
            :key="group.id"
            class="group"
            :class="{
              disabled: !group.isActive,
              dragging: dragState?.type === 'group' && dragState.id === group.id,
              'drag-over': dragOver === `group:${group.id}`
            }"
            :data-group-id="group.id"
            draggable="true"
            @dragstart="beginGroupDrag($event, group.id)"
            @dragover="allowDrop($event, `group:${group.id}`)"
            @drop="dropOnGroup($event, group)"
            @dragend="endDrag"
          >
            <div class="group-head">
              <div class="drag-handle" title="拖动打印组排序">⋮⋮</div>
              <div>
                <div class="group-name">{{ group.name }}</div>
                <div class="group-meta">
                  {{ group.code }} · {{ group.paperSize }}
                  {{ group.orientation === 'PORTRAIT' ? '纵向' : '横向' }} · {{ group.paperType }} ·
                  成品 {{ group.frameWidthMm || '-' }}×{{ group.frameHeightMm || '-' }}mm · 单页{{
                    group.framesPerSheet
                  }}帧 · {{ group.renderDpi }}DPI · 白线{{ group.separatorMicrons }}μm{{
                    group.cuttingTool ? ` · 模具 ${group.cuttingTool}` : ''
                  }}
                </div>
                <div class="group-meta template-meta">
                  当前模板：{{
                    activeTemplate(group)
                      ? `${activeTemplate(group)!.originalName} · V${activeTemplate(group)!.versionNo}`
                      : '尚未上传'
                  }}
                </div>
              </div>
              <div class="actions">
                <button class="btn btn-sm" type="button" @click="openSku(group)">添加 SKU</button>
                <button class="btn btn-sm" type="button" @click="openTemplate(group)">
                  上传模板
                </button>
                <button class="btn btn-sm" type="button" @click="openGroup(group)">编辑</button>
                <button
                  class="btn btn-sm"
                  type="button"
                  :disabled="busy"
                  @click="toggleGroup(group)"
                >
                  {{ group.isActive ? '停用' : '启用' }}
                </button>
              </div>
            </div>
            <div
              class="sku-list"
              :class="{ 'drag-over': dragOver === `group:${group.id}` }"
              @dragover="allowDrop($event, `group:${group.id}`)"
              @drop="dropOnGroup($event, group)"
            >
              <div v-if="!group.rules.length" class="empty">
                拖入尺寸相同的 SKU，或点击“添加 SKU”
              </div>
              <div
                v-for="rule in group.rules"
                v-else
                :key="rule.id"
                class="sku-card"
                :class="{
                  inactive: !(skuFor(rule).isActive && skuFor(rule).modelActive),
                  dragging: dragState?.type === 'sku' && dragState.ruleId === rule.id,
                  'drag-over': dragOver === `rule:${rule.id}`
                }"
                :data-sku-id="rule.skuId"
                :data-rule-id="rule.id"
                draggable="true"
                @dragstart="beginSkuDrag($event, rule.skuId, rule.id)"
                @dragover="allowDrop($event, `rule:${rule.id}`)"
                @drop="dropOnRule($event, group, rule)"
                @dragend="endDrag"
              >
                <div class="drag-handle" title="拖动排序">⋮⋮</div>
                <img
                  v-if="safeImageUrl(skuFor(rule).previewUrl)"
                  class="sku-img"
                  :src="safeImageUrl(skuFor(rule).previewUrl) || undefined"
                  :alt="skuFor(rule).modelName"
                />
                <div v-else class="sku-img placeholder">无图</div>
                <div>
                  <div class="sku-title">
                    {{ skuFor(rule).modelName }} · {{ skuFor(rule).skuCode || '未设置SKU编码' }}
                  </div>
                  <div class="sku-code">{{ rule.skuId }}</div>
                </div>
                <div class="sku-field">
                  <span>尺寸 / 帧数</span>{{ skuFor(rule).size }} · {{ skuFor(rule).frameCount }}帧
                </div>
                <div class="sku-field"><span>材质</span>{{ skuFor(rule).material }}</div>
                <div class="sku-field">
                  <span>颜色</span
                  ><i class="color-dot" :style="{ background: skuFor(rule).colorHex }"></i
                  >{{ skuFor(rule).colorName }}
                </div>
                <div class="sku-field">
                  <span>状态</span
                  >{{ skuFor(rule).isActive && skuFor(rule).modelActive ? '已上架' : '已下架' }}
                </div>
                <div class="sku-field"><span>预计页数</span>{{ rule.pagesPerUnit }}页</div>
                <button class="btn btn-sm" type="button" @click="removeRule(rule)">移出</button>
              </div>
            </div>
          </section>
          <div v-if="!groups.length" class="empty">还没有打印裁切组，请先新增</div>
        </div>
        <section
          class="unassigned"
          :class="{ 'drag-over': dragOver === 'unassigned' }"
          @dragover="
            dragState?.type === 'sku' && dragState.ruleId
              ? allowDrop($event, 'unassigned')
              : undefined
          "
          @drop="dropUnassigned"
        >
          <div class="unassigned-head">
            <div>
              <h3>尚未配置的 SKU</h3>
              <p class="muted">来自款式管理；未确认也可在预警后进入生产，但会排在打印队列末尾。</p>
            </div>
          </div>
          <div class="unassigned-list">
            <div
              v-for="sku in unassigned"
              :key="sku.id"
              class="sku-card"
              :class="{
                inactive: !(sku.isActive && sku.modelActive),
                dragging: dragState?.type === 'sku' && dragState.skuId === sku.id
              }"
              :data-sku-id="sku.id"
              draggable="true"
              @dragstart="beginSkuDrag($event, sku.id, null)"
              @dragend="endDrag"
            >
              <div class="drag-handle" title="拖动排序">⋮⋮</div>
              <img
                v-if="safeImageUrl(sku.previewUrl)"
                class="sku-img"
                :src="safeImageUrl(sku.previewUrl) || undefined"
                :alt="sku.modelName"
              />
              <div v-else class="sku-img placeholder">无图</div>
              <div>
                <div class="sku-title">
                  {{ sku.modelName }} · {{ sku.skuCode || '未设置SKU编码' }}
                </div>
                <div class="sku-code">{{ sku.id }}</div>
              </div>
              <div class="sku-field">
                <span>尺寸 / 帧数</span>{{ sku.size }} · {{ sku.frameCount }}帧
              </div>
              <div class="sku-field"><span>材质</span>{{ sku.material }}</div>
              <div class="sku-field">
                <span>颜色</span><i class="color-dot" :style="{ background: sku.colorHex }"></i
                >{{ sku.colorName }}
              </div>
              <div class="sku-field">
                <span>状态</span>{{ sku.isActive && sku.modelActive ? '已上架' : '已下架' }}
              </div>
              <div class="sku-field"><span>预计页数</span>待确认</div>
            </div>
            <div v-if="!unassigned.length" class="empty">全部已上架 SKU 都已配置</div>
          </div>
        </section>
      </div>
    </main>

    <div v-if="groupOpen" class="overlay show">
      <div
        class="modal"
        role="dialog"
        :aria-label="editingGroupId ? '编辑打印裁切组' : '新增打印裁切组'"
      >
        <div class="modal-head">
          <h2>{{ editingGroupId ? '编辑打印裁切组' : '新增打印裁切组' }}</h2>
          <button class="btn" type="button" @click="groupOpen = false">关闭</button>
        </div>
        <div class="modal-body">
          <div class="form-grid">
            <div class="field full">
              <label for="printGroupName">组名</label
              ><input
                id="printGroupName"
                v-model="groupForm.name"
                placeholder="例如：A4纸 · 5×5cm · 单页12帧"
              />
            </div>
            <div class="field">
              <label for="printGroupSize">帧图尺寸</label
              ><select id="printGroupSize" v-model="groupForm.size">
                <option v-if="!sizeOptions.length" value="">请先在款式管理建立SKU</option>
                <option v-for="size in sizeOptions" :key="size">{{ size }}</option>
              </select>
            </div>
            <div class="field">
              <label for="framesPerSheet">每页容纳帧数</label
              ><input
                id="framesPerSheet"
                v-model.number="groupForm.framesPerSheet"
                type="number"
                min="1"
                placeholder="12"
              />
            </div>
            <div class="field">
              <label for="paperSize">纸张规格</label
              ><input id="paperSize" v-model="groupForm.paperSize" placeholder="A4" />
            </div>
            <div class="field">
              <label for="paperType">纸张类型</label
              ><input id="paperType" v-model="groupForm.paperType" placeholder="普通打印纸" />
            </div>
            <div class="field">
              <label for="orientation">纸张方向</label
              ><select id="orientation" v-model="groupForm.orientation">
                <option value="LANDSCAPE">横向</option>
                <option value="PORTRAIT">纵向</option>
              </select>
            </div>
            <div class="field">
              <label for="renderDpi">输出清晰度</label
              ><select id="renderDpi" v-model.number="groupForm.renderDpi">
                <option :value="600">600 DPI（推荐）</option>
                <option :value="300">300 DPI</option>
              </select>
            </div>
            <div class="field">
              <label for="frameWidthMm">成品宽度（毫米）</label
              ><input
                id="frameWidthMm"
                v-model.number="groupForm.frameWidthMm"
                type="number"
                min="1"
                placeholder="50"
              />
            </div>
            <div class="field">
              <label for="frameHeightMm">成品高度（毫米）</label
              ><input
                id="frameHeightMm"
                v-model.number="groupForm.frameHeightMm"
                type="number"
                min="1"
                placeholder="50"
              />
            </div>
            <div class="field">
              <label for="separatorMicrons">中间白线（微米）</label
              ><input
                id="separatorMicrons"
                v-model.number="groupForm.separatorMicrons"
                type="number"
                min="1"
              />
            </div>
            <div class="field">
              <label for="cuttingTool">裁切模具</label
              ><input id="cuttingTool" v-model="groupForm.cuttingTool" placeholder="可暂不填写" />
            </div>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn" type="button" @click="groupOpen = false">取消</button
          ><button class="btn btn-black" type="button" :disabled="busy" @click="submitGroup">
            保存
          </button>
        </div>
      </div>
    </div>

    <div v-if="templateOpen" class="overlay show">
      <div class="modal template-modal" role="dialog" aria-label="上传 Word 排版模板">
        <div class="modal-head">
          <div>
            <h2>上传 Word 排版模板</h2>
            <p class="muted">
              {{ templateGroup?.name }} · {{ templateGroup?.paperSize }} ·
              {{ templateGroup?.size }} · 单页 {{ templateGroup?.framesPerSheet }} 帧
            </p>
          </div>
          <button class="btn" type="button" @click="templateOpen = false">关闭</button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label for="templateFile">一页模板（.docx）</label
            ><input
              id="templateFile"
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              @change="chooseTemplate"
            />
          </div>
          <p class="muted template-help">
            模板只保留一页，表格单元格数量必须等于该组的每页帧数。新上传会形成新版本，旧生产文件不受影响。
          </p>
        </div>
        <div class="modal-actions">
          <button class="btn" type="button" @click="templateOpen = false">取消</button
          ><button class="btn btn-black" type="button" :disabled="busy" @click="submitTemplate">
            上传并启用
          </button>
        </div>
      </div>
    </div>

    <div v-if="skuOpen" class="overlay show">
      <div class="modal" role="dialog" aria-label="添加 SKU">
        <div class="modal-head">
          <div>
            <h2>添加 SKU</h2>
            <p class="muted">只显示尺寸为 {{ activeGroup?.size }} 且尚未分配的 SKU</p>
          </div>
          <button class="btn" type="button" @click="skuOpen = false">关闭</button>
        </div>
        <div class="modal-body">
          <div class="filter-row">
            <input
              v-model="filters.search"
              aria-label="搜索款式或SKU编码"
              placeholder="搜索款式或SKU编码"
            /><select v-model="filters.frame" aria-label="帧数筛选">
              <option value="">全部帧数</option>
              <option v-for="frame in pickerFrames" :key="frame" :value="String(frame)">
                {{ frame }}帧
              </option></select
            ><select v-model="filters.material" aria-label="材质筛选">
              <option value="">全部材质</option>
              <option v-for="item in pickerMaterials" :key="item">{{ item }}</option></select
            ><select v-model="filters.color" aria-label="颜色筛选">
              <option value="">全部颜色</option>
              <option v-for="item in pickerColors" :key="item">{{ item }}</option>
            </select>
          </div>
          <label class="select-all"
            ><input
              type="checkbox"
              @change="toggleAll(($event.target as HTMLInputElement).checked)"
            />
            全选当前结果</label
          >
          <div class="pick-list">
            <label v-for="sku in pickerRows" :key="sku.id" class="pick"
              ><input
                type="checkbox"
                :checked="pickedSkuIds.includes(sku.id)"
                @change="setPicked(sku.id, ($event.target as HTMLInputElement).checked)"
              /><img
                v-if="safeImageUrl(sku.previewUrl)"
                :src="safeImageUrl(sku.previewUrl) || undefined"
                alt=""
              />
              <div v-else class="sku-img placeholder picker-placeholder">无图</div>
              <div>
                <div class="sku-title">{{ sku.modelName }} · {{ sku.skuCode || '未设置编码' }}</div>
                <div class="sku-code">
                  {{ sku.size }} · {{ sku.frameCount }}帧 · {{ sku.material }} ·
                  {{ sku.colorName }} · {{ sku.isActive && sku.modelActive ? '已上架' : '已下架' }}
                </div>
              </div></label
            >
            <div v-if="!pickerRows.length" class="empty">没有符合条件的 SKU</div>
          </div>
        </div>
        <div class="modal-actions">
          <span class="muted picked-count">已选择 {{ pickedSkuIds.length }} 个</span
          ><button class="btn" type="button" @click="skuOpen = false">取消</button
          ><button class="btn btn-black" type="button" :disabled="busy" @click="submitRules">
            添加所选 SKU
          </button>
        </div>
      </div>
    </div>
    <div v-if="notice" class="toast" role="status">{{ notice }}</div>
  </div>
</template>
