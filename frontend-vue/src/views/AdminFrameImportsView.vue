<script setup lang="ts">
/* eslint-disable vue/html-closing-bracket-newline, vue/html-indent, vue/multiline-html-element-content-newline */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AdminSidebar from '@/components/AdminSidebar.vue'
import {
  commitImportBatch,
  createImportBatch,
  getImportBatch,
  listImportBatches,
  patchImportItem,
  patchImportItems,
  preflightImportBatch,
  uploadImportFile,
  type ImportBatch,
  type ImportBatchSummary,
  type ImportItem,
  type LocalImportGroup
} from '@/features/admin-frame-imports/api'
import './admin-frame-imports.css'

const MAX_GROUPS = 100
const MAX_FILES = 2000
const MAX_BYTES = 500 * 1024 * 1024
const route = useRoute()
const router = useRouter()
const collapsed = ref(false)
const mobileOpen = ref(false)
const groups = ref<LocalImportGroup[]>([])
const selected = ref(new Set<string>())
const currentBatch = ref<ImportBatch | null>(null)
const historyRows = ref<ImportBatchSummary[]>([])
const folderInput = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const notice = ref('')
const historyError = ref('')
const folderSummary = ref('尚未选择文件夹')
const progress = reactive({ visible: false, done: 0, total: 0, label: '' })
const form = reactive({
  batchType: 'COMPANY' as 'COMPANY' | 'CUSTOMER',
  usageType: 'INTERNAL_TEST',
  authorizationStatus: 'PRIVATE_ONLY',
  rightsHolderName: '哞屋',
  rightsHolderContact: '',
  tags: '',
  internalNotes: ''
})
const bulkTagsValue = ref('')
const bulkUsage = ref('')
let requestFingerprint = ''
let clientRequestId = ''

const rows = computed<Array<LocalImportGroup | ImportItem>>(
  () => currentBatch.value?.items || groups.value
)
const completed = computed(() => currentBatch.value?.status === 'COMPLETED')
const step = computed(() => {
  if (completed.value) return 4
  if (currentBatch.value) return 3
  return groups.value.length ? 2 : 1
})
const canUpload = computed(
  () => groups.value.length > 0 && !groups.value.some((group) => group.status === 'BLOCKED')
)
const canCommit = computed(() =>
  currentBatch.value?.items.some((item) => ['READY', 'WARNING', 'FAILED'].includes(item.status))
)
const summary = computed(() => ({
  items: rows.value.length,
  files:
    currentBatch.value?.totalFiles ||
    groups.value.reduce((total, group) => total + group.files.length, 0),
  ready: rows.value.filter((item) =>
    ['LOCAL', 'READY', 'WARNING', 'IMPORTED'].includes(item.status)
  ).length,
  problems: rows.value.filter((item) => ['BLOCKED', 'FAILED'].includes(item.status)).length
}))

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : '网络错误'
}
function flash(text: string): void {
  notice.value = text
  window.setTimeout(() => {
    if (notice.value === text) notice.value = ''
  }, 2800)
}
function splitTags(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[，,]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  ].slice(0, 30)
}
function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)}KB`
    : `${(bytes / 1024 / 1024).toFixed(1)}MB`
}
function formatTime(value: string): string {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-'
}
function statusText(status: string): string {
  return (
    {
      LOCAL: '待上传',
      UPLOADING: '上传中',
      READY: '可入库',
      WARNING: '需要确认',
      BLOCKED: '无法入库',
      IMPORTING: '入库中',
      IMPORTED: '已入库',
      FAILED: '导入失败',
      SKIPPED_DUPLICATE: '重复已跳过',
      PARTIAL: '部分完成',
      COMPLETED: '已完成'
    }[status] || status
  )
}
function rowId(item: LocalImportGroup | ImportItem): string {
  return 'id' in item && item.id ? item.id : (item as LocalImportGroup).localId
}
function frameCount(item: LocalImportGroup | ImportItem): number {
  return 'files' in item ? item.files.length : item.frameCount
}
function isLocked(item: LocalImportGroup | ImportItem): boolean {
  return ['IMPORTED', 'SKIPPED_DUPLICATE', 'IMPORTING'].includes(item.status)
}
function preview(item: LocalImportGroup | ImportItem): string {
  return 'previewUrl' in item ? item.previewUrl || '' : ''
}
function applyTypeDefaults(): void {
  const customer = form.batchType === 'CUSTOMER'
  form.usageType = customer ? 'PRIVATE_CUSTOM' : 'INTERNAL_TEST'
  form.authorizationStatus = 'PRIVATE_ONLY'
  if (!customer) {
    form.rightsHolderName = '哞屋'
    form.rightsHolderContact = ''
  }
}
function defaults() {
  const customer = form.batchType === 'CUSTOMER'
  return {
    sourceChannel: customer ? 'OFFLINE_CUSTOM' : 'INTERNAL_CREATED',
    usageType: form.usageType,
    rightsHolderType: customer ? 'OFFLINE_CUSTOMER' : 'COMPANY',
    rightsHolderName: form.rightsHolderName.trim(),
    rightsHolderContact: form.rightsHolderContact.trim(),
    authorizationStatus: form.authorizationStatus,
    tags: splitTags(form.tags),
    internalNotes: form.internalNotes.trim()
  }
}
function releasePreviews(): void {
  groups.value.forEach((group) => URL.revokeObjectURL(group.previewUrl))
}
function startNewBatch(): void {
  releasePreviews()
  groups.value = []
  selected.value = new Set()
  currentBatch.value = null
  folderSummary.value = '尚未选择文件夹'
  progress.visible = false
  requestFingerprint = ''
  clientRequestId = ''
  if (folderInput.value) folderInput.value.value = ''
  applyTypeDefaults()
  void router.replace({ name: 'admin-frame-imports' })
}
function normalizeMime(file: File): string {
  if (file.type) return file.type
  if (/\.png$/i.test(file.name)) return 'image/png'
  return /\.jpe?g$/i.test(file.name) ? 'image/jpeg' : ''
}
function frameNumber(file: File): number | null {
  const name = file.name.replace(/\.[^.]+$/, '')
  return /^\d+$/.test(name) ? Number(name) : null
}
function parseFolder(files: File[]): void {
  releasePreviews()
  groups.value = []
  selected.value = new Set()
  currentBatch.value = null
  const map = new Map<string, Array<File & { _mime?: string; _order?: number }>>()
  const errors: string[] = []
  let totalBytes = 0
  for (const raw of files) {
    const file = raw as File & { webkitRelativePath?: string; _mime?: string; _order?: number }
    const parts = String(file.webkitRelativePath || file.name)
      .split('/')
      .filter(Boolean)
    if (parts.length !== 3) {
      errors.push(`${file.webkitRelativePath || file.name} 不在第一层动画子文件夹内`)
      continue
    }
    const folderName = parts[1] || ''
    const mime = normalizeMime(file)
    const order = frameNumber(file)
    if (!['image/png', 'image/jpeg'].includes(mime)) {
      errors.push(`${folderName}/${file.name} 不是 PNG/JPG`)
      continue
    }
    if (order === null) {
      errors.push(`${folderName}/${file.name} 没有使用数字文件名`)
      continue
    }
    totalBytes += file.size
    file._mime = mime
    file._order = order
    const list = map.get(folderName) || []
    list.push(file)
    map.set(folderName, list)
  }
  if (errors.length) {
    folderSummary.value = errors.slice(0, 2).join('；')
    flash(`发现 ${errors.length} 个目录或文件问题`)
    return
  }
  if (map.size > MAX_GROUPS) return flash(`一次最多选择 ${MAX_GROUPS} 个动画文件夹`)
  if (files.length > MAX_FILES) return flash(`一次最多选择 ${MAX_FILES} 张图片`)
  if (totalBytes > MAX_BYTES) return flash('一次导入不能超过 500MB')
  const base = defaults()
  groups.value = [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'zh-CN', { numeric: true }))
    .map(([folderName, frames], index) => {
      frames.sort((a, b) => Number(a._order) - Number(b._order))
      const orders = frames.map((file) => Number(file._order))
      const issues: LocalImportGroup['issues'] = []
      if (frames.length < 2 || frames.length > 50)
        issues.push({ level: 'ERROR', message: '每套需要2至50张图片' })
      if (new Set(orders).size !== orders.length)
        issues.push({ level: 'ERROR', message: '存在重复帧序号' })
      if (orders.some((value, position) => position > 0 && value !== orders[position - 1]! + 1))
        issues.push({ level: 'WARNING', message: '帧序号不连续' })
      return {
        localId: String(index),
        folderName,
        relativePath: folderName,
        title: folderName,
        files: frames,
        previewUrl: URL.createObjectURL(frames[0]!),
        ...base,
        tags: [...base.tags],
        issues,
        status: issues.some((issue) => issue.level === 'ERROR')
          ? 'BLOCKED'
          : issues.length
            ? 'WARNING'
            : 'LOCAL'
      }
    })
  selected.value = new Set(groups.value.map((group) => group.localId))
  folderSummary.value = `${groups.value.length} 套动画 · ${files.length} 张图片 · ${formatBytes(totalBytes)}`
  requestFingerprint = JSON.stringify(
    groups.value.flatMap((group) =>
      group.files.map((file) => [group.folderName, file.name, file.size, file.lastModified])
    )
  )
  clientRequestId = crypto.randomUUID()
}
function applyDefaultsToGroups(): void {
  const base = defaults()
  groups.value.forEach((group) => Object.assign(group, { ...base, tags: [...base.tags] }))
  flash('共同资料已应用到全部动画')
}
function toggleItem(id: string, checked: boolean): void {
  const next = new Set(selected.value)
  if (checked) next.add(id)
  else next.delete(id)
  selected.value = next
}
function toggleAll(checked: boolean): void {
  selected.value = new Set(checked ? rows.value.map(rowId) : [])
}
async function editItem(
  item: LocalImportGroup | ImportItem,
  field: string,
  value: unknown
): Promise<void> {
  const normalized = field === 'tags' ? splitTags(String(value)) : value
  ;(item as unknown as Record<string, unknown>)[field] = normalized
  if (!currentBatch.value || !('id' in item)) return
  try {
    await patchImportItem(currentBatch.value.id, item.id, { [field]: normalized })
  } catch (cause) {
    flash(message(cause))
    await loadBatch(currentBatch.value.id)
  }
}
async function applyBulkTags(mode: 'add' | 'remove'): Promise<void> {
  const tags = splitTags(bulkTagsValue.value)
  if (!tags.length || !selected.value.size) return flash('请先选择项目并填写标签')
  if (!currentBatch.value) {
    groups.value
      .filter((item) => selected.value.has(item.localId))
      .forEach((item) => {
        const set = new Set(item.tags)
        tags.forEach((tag) => (mode === 'add' ? set.add(tag) : set.delete(tag)))
        item.tags = [...set]
      })
    return
  }
  await patchImportItems(currentBatch.value.id, {
    itemIds: [...selected.value],
    [mode === 'add' ? 'addTags' : 'removeTags']: tags
  })
  await loadBatch(currentBatch.value.id)
}
async function applyBulkUsage(): Promise<void> {
  if (!bulkUsage.value || !selected.value.size) return flash('请先选择项目和用途')
  if (!currentBatch.value) {
    groups.value
      .filter((item) => selected.value.has(item.localId))
      .forEach((item) => (item.usageType = bulkUsage.value))
    return
  }
  await patchImportItems(currentBatch.value.id, {
    itemIds: [...selected.value],
    usageType: bulkUsage.value
  })
  await loadBatch(currentBatch.value.id)
}
async function loadHistory(): Promise<void> {
  historyError.value = ''
  try {
    historyRows.value = await listImportBatches()
  } catch (cause) {
    historyError.value = message(cause)
  }
}
async function loadBatch(id: string): Promise<void> {
  try {
    releasePreviews()
    groups.value = []
    currentBatch.value = await getImportBatch(id)
    selected.value = new Set(
      currentBatch.value.items
        .filter((item) => !['IMPORTED', 'SKIPPED_DUPLICATE', 'IMPORTING'].includes(item.status))
        .map((item) => item.id)
    )
    const saved = currentBatch.value.defaults || {}
    form.batchType = currentBatch.value.batchType
    form.usageType = String(saved.usageType || 'INTERNAL_TEST')
    form.authorizationStatus = String(saved.authorizationStatus || 'PRIVATE_ONLY')
    form.rightsHolderName = String(saved.rightsHolderName || '')
    form.rightsHolderContact = String(saved.rightsHolderContact || '')
    form.tags = Array.isArray(saved.tags) ? saved.tags.join(',') : ''
    form.internalNotes = String(saved.internalNotes || '')
    folderSummary.value = `${currentBatch.value.batchNo} · ${currentBatch.value.totalItems} 套 · ${currentBatch.value.totalFiles} 张 · ${formatBytes(currentBatch.value.totalBytes)}`
    if (route.query.batchId !== id) await router.replace({ query: { batchId: id } })
  } catch (cause) {
    flash(message(cause))
  }
}
async function createAndUpload(): Promise<void> {
  if (!groups.value.length || !canUpload.value || busy.value) return
  const fingerprint = JSON.stringify(
    groups.value.flatMap((group) =>
      group.files.map((file) => [group.folderName, file.name, file.size, file.lastModified])
    )
  )
  if (fingerprint !== requestFingerprint) {
    requestFingerprint = fingerprint
    clientRequestId = crypto.randomUUID()
  }
  busy.value = true
  progress.visible = true
  try {
    const created = await createImportBatch({
      clientRequestId,
      batchType: form.batchType,
      defaults: defaults(),
      groups: groups.value.map((group) => ({
        folderName: group.folderName,
        relativePath: group.relativePath,
        title: group.title,
        tags: group.tags,
        sourceChannel: group.sourceChannel,
        usageType: group.usageType,
        rightsHolderType: group.rightsHolderType,
        rightsHolderName: group.rightsHolderName,
        rightsHolderContact: group.rightsHolderContact,
        authorizationStatus: group.authorizationStatus,
        internalNotes: group.internalNotes,
        files: group.files.map((file) => ({
          name: file.name,
          type: file._mime || file.type,
          size: file.size
        }))
      }))
    })
    const fileMap = new Map(
      groups.value.flatMap((group) =>
        group.files.map(
          (file) => [`${group.folderName}\u0000${file.name}\u0000${file._order}`, file] as const
        )
      )
    )
    let cursor = 0
    let done = 0
    progress.total = created.uploads.length
    progress.label = '正在上传'
    const worker = async () => {
      while (cursor < created.uploads.length) {
        const job = created.uploads[cursor++]!
        const file = fileMap.get(`${job.folderName}\u0000${job.name}\u0000${job.order}`)
        if (!file) throw new Error(`无法匹配上传文件：${job.folderName}/${job.name}`)
        await uploadImportFile(job, file)
        progress.done = ++done
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, created.uploads.length) }, worker))
    progress.label = '正在检查'
    await preflightImportBatch(created.id)
    await Promise.all([loadBatch(created.id), loadHistory()])
    flash('上传和预检完成')
  } catch (cause) {
    flash(message(cause))
  } finally {
    busy.value = false
  }
}
async function rerunPreflight(): Promise<void> {
  if (!currentBatch.value || busy.value) return
  busy.value = true
  try {
    await preflightImportBatch(currentBatch.value.id)
    await Promise.all([loadBatch(currentBatch.value.id), loadHistory()])
    flash('重新检查完成')
  } catch (cause) {
    flash(message(cause))
  } finally {
    busy.value = false
  }
}
async function commitItems(): Promise<void> {
  if (!currentBatch.value || busy.value) return
  const ids = [...selected.value].filter((id) =>
    currentBatch.value!.items.some(
      (item) => item.id === id && ['READY', 'WARNING', 'FAILED'].includes(item.status)
    )
  )
  if (!ids.length) return flash('没有可入库的已选项目')
  busy.value = true
  try {
    await commitImportBatch(currentBatch.value.id, ids)
    await Promise.all([loadBatch(currentBatch.value.id), loadHistory()])
    flash('批量入库处理完成')
  } catch (cause) {
    flash(message(cause))
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  await loadHistory()
  const id = typeof route.query.batchId === 'string' ? route.query.batchId : ''
  if (id) await loadBatch(id)
})
onBeforeUnmount(releasePreviews)
</script>

<template>
  <div class="imports-page">
    <AdminSidebar
      :collapsed="collapsed"
      :mobile-open="mobileOpen"
      @update:collapsed="collapsed = $event"
      @update:mobile-open="mobileOpen = $event"
    />
    <main class="imports-main" :class="{ expanded: collapsed }">
      <header class="imports-topbar">
        <div class="inline-actions">
          <button class="btn menu-btn" type="button" @click="mobileOpen = true">☰</button>
          <h1>帧图批量导入</h1>
        </div>
        <div class="top-actions">
          <button class="btn" type="button" :disabled="busy" @click="startNewBatch">
            新建批次
          </button>
          <button class="btn" type="button" :disabled="busy" @click="loadHistory">刷新</button>
        </div>
      </header>
      <div class="imports-content">
        <nav class="steps">
          <template
            v-for="(label, index) in ['选择文件夹', '填写资料', '上传预检', '确认入库']"
            :key="label"
          >
            <div class="step" :class="{ active: step === index + 1, done: step > index + 1 }">
              <i>{{ index + 1 }}</i
              ><span>{{ label }}</span>
            </div>
            <div v-if="index < 3" class="step-line"></div>
          </template>
        </nav>

        <section class="panel setup">
          <div class="setup-grid">
            <div class="field">
              <label>素材批次类型</label
              ><select
                v-model="form.batchType"
                :disabled="Boolean(currentBatch)"
                @change="applyTypeDefaults"
              >
                <option value="COMPANY">公司素材</option>
                <option value="CUSTOMER">客户私人素材</option>
              </select>
            </div>
            <div class="field">
              <label>默认用途</label
              ><select v-model="form.usageType" :disabled="Boolean(currentBatch)">
                <option value="INTERNAL_TEST">内部测试</option>
                <option value="UNDECIDED">暂未确定</option>
                <option value="COMPANY_PRODUCT">公司自营商品</option>
                <option value="PRIVATE_CUSTOM">私人定制</option>
              </select>
            </div>
            <div class="field">
              <label>授权状态</label
              ><select v-model="form.authorizationStatus" :disabled="Boolean(currentBatch)">
                <option value="PRIVATE_ONLY">仅限内部或私人使用</option>
                <option value="PENDING">授权确认中</option>
                <option value="AUTHORIZED">已明确授权</option>
              </select>
            </div>
            <div class="field">
              <label>权利人名称</label
              ><input
                v-model="form.rightsHolderName"
                :disabled="Boolean(currentBatch)"
                maxlength="120"
              />
            </div>
            <div class="field">
              <label>联系方式</label
              ><input
                v-model="form.rightsHolderContact"
                :disabled="Boolean(currentBatch)"
                maxlength="200"
              />
            </div>
            <div class="field wide">
              <label>共同标签</label
              ><input
                id="defaultTags"
                v-model="form.tags"
                :disabled="Boolean(currentBatch)"
                maxlength="300"
                placeholder="多个标签用逗号分隔"
              />
            </div>
            <div class="field wide">
              <label>共同内部备注</label
              ><input
                v-model="form.internalNotes"
                :disabled="Boolean(currentBatch)"
                maxlength="500"
              />
            </div>
          </div>
          <div class="folder-bar">
            <div class="folder-summary">{{ folderSummary }}</div>
            <div class="inline-actions">
              <input
                id="folderInput"
                ref="folderInput"
                type="file"
                webkitdirectory
                multiple
                accept="image/png,image/jpeg"
                hidden
                @change="parseFolder([...(($event.target as HTMLInputElement).files || [])])"
              />
              <button
                class="btn"
                type="button"
                :disabled="Boolean(currentBatch) || busy"
                @click="folderInput?.click()"
              >
                选择总文件夹
              </button>
              <button
                class="btn btn-black"
                type="button"
                :disabled="!groups.length || busy"
                @click="applyDefaultsToGroups"
              >
                将共同资料应用到全部
              </button>
            </div>
          </div>
        </section>

        <div class="work-layout">
          <section class="panel table-panel">
            <div class="table-tools">
              <label class="select-all"
                ><input
                  type="checkbox"
                  :checked="rows.length > 0 && selected.size === rows.length"
                  @change="toggleAll(($event.target as HTMLInputElement).checked)"
                />
                全选当前项目</label
              >
              <div class="bulk-actions">
                <input v-model="bulkTagsValue" placeholder="标签" /><button
                  class="btn"
                  type="button"
                  @click="applyBulkTags('add')"
                >
                  添加标签</button
                ><button class="btn" type="button" @click="applyBulkTags('remove')">
                  移除标签
                </button>
                <select v-model="bulkUsage">
                  <option value="">选择用途</option>
                  <option value="INTERNAL_TEST">内部测试</option>
                  <option value="UNDECIDED">暂未确定</option>
                  <option value="COMPANY_PRODUCT">公司自营商品</option>
                  <option value="PRIVATE_CUSTOM">私人定制</option></select
                ><button class="btn" type="button" @click="applyBulkUsage">应用用途</button>
              </div>
            </div>
            <div class="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th class="check-col"></th>
                    <th class="preview-col">预览</th>
                    <th>动画名称</th>
                    <th class="count-col">帧数</th>
                    <th>标签</th>
                    <th class="usage-col">用途</th>
                    <th>权利人</th>
                    <th class="result-col">检查结果</th>
                  </tr>
                </thead>
                <tbody id="itemRows">
                  <tr v-if="!rows.length">
                    <td colspan="8"><div class="empty">请选择包含动画子文件夹的总文件夹</div></td>
                  </tr>
                  <tr v-for="item in rows" :key="rowId(item)">
                    <td>
                      <input
                        type="checkbox"
                        :checked="selected.has(rowId(item))"
                        @change="
                          toggleItem(rowId(item), ($event.target as HTMLInputElement).checked)
                        "
                      />
                    </td>
                    <td>
                      <div class="thumb">
                        <img v-if="preview(item)" :src="preview(item)" alt="" /><span v-else
                          >无预览</span
                        >
                      </div>
                    </td>
                    <td>
                      <input
                        class="row-title"
                        :value="item.title"
                        :disabled="isLocked(item)"
                        @change="editItem(item, 'title', ($event.target as HTMLInputElement).value)"
                      />
                      <div class="folder-name">{{ item.folderName }}</div>
                    </td>
                    <td>
                      <strong>{{ frameCount(item) }}</strong>
                    </td>
                    <td>
                      <input
                        class="row-tags"
                        :value="item.tags.join(',')"
                        :disabled="isLocked(item)"
                        @change="editItem(item, 'tags', ($event.target as HTMLInputElement).value)"
                      />
                    </td>
                    <td>
                      <select
                        :value="item.usageType"
                        :disabled="isLocked(item)"
                        @change="
                          editItem(item, 'usageType', ($event.target as HTMLSelectElement).value)
                        "
                      >
                        <option value="INTERNAL_TEST">内部测试</option>
                        <option value="UNDECIDED">暂未确定</option>
                        <option value="COMPANY_PRODUCT">公司自营商品</option>
                        <option value="PRIVATE_CUSTOM">私人定制</option>
                      </select>
                    </td>
                    <td>
                      <input
                        class="row-holder"
                        :value="item.rightsHolderName || ''"
                        :disabled="isLocked(item)"
                        @change="
                          editItem(
                            item,
                            'rightsHolderName',
                            ($event.target as HTMLInputElement).value
                          )
                        "
                      />
                    </td>
                    <td>
                      <span class="status" :class="`status-${item.status.toLowerCase()}`">{{
                        statusText(item.status)
                      }}</span>
                      <div v-if="'assetNo' in item && item.assetNo" class="asset-link">
                        <RouterLink
                          :to="{ name: 'admin-frame-library', query: { keyword: item.assetNo } }"
                          >{{ item.assetNo }}</RouterLink
                        >
                      </div>
                      <div
                        v-if="item.issues.length"
                        class="issues"
                        :class="{ error: item.issues.some((issue) => issue.level === 'ERROR') }"
                      >
                        <span v-for="issue in item.issues" :key="`${issue.code}-${issue.message}`"
                          >{{ issue.message }}<br
                        /></span>
                      </div>
                      <label
                        v-if="
                          'duplicateAssetId' in item && item.duplicateAssetId && !isLocked(item)
                        "
                        class="duplicate"
                        ><input
                          type="checkbox"
                          :checked="item.allowDuplicate"
                          @change="
                            editItem(
                              item,
                              'allowDuplicate',
                              ($event.target as HTMLInputElement).checked
                            )
                          "
                        />
                        仍然导入</label
                      >
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <aside class="side">
            <section class="panel side-section">
              <div class="side-title">当前批次</div>
              <div class="summary-grid">
                <div class="summary-item">
                  <b>{{ summary.items }}</b
                  ><span>动画组</span>
                </div>
                <div class="summary-item">
                  <b>{{ summary.files }}</b
                  ><span>图片</span>
                </div>
                <div class="summary-item">
                  <b>{{ summary.ready }}</b
                  ><span>{{ completed ? '已入库' : '可入库' }}</span>
                </div>
                <div class="summary-item">
                  <b>{{ summary.problems }}</b
                  ><span>需处理</span>
                </div>
              </div>
              <div v-if="progress.visible" class="progress">
                <div class="progress-track">
                  <div
                    class="progress-fill"
                    :style="{
                      width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`
                    }"
                  ></div>
                </div>
                <div class="progress-text">
                  {{ progress.label }} {{ progress.done }}/{{ progress.total }}
                </div>
              </div>
              <div class="inline-actions action-row">
                <button
                  v-if="!currentBatch"
                  class="btn btn-black"
                  type="button"
                  :disabled="!canUpload || busy"
                  @click="createAndUpload"
                >
                  上传并预检</button
                ><button
                  v-if="currentBatch && !completed"
                  class="btn"
                  type="button"
                  :disabled="busy"
                  @click="rerunPreflight"
                >
                  重新检查</button
                ><button
                  v-if="currentBatch && canCommit"
                  class="btn btn-black"
                  type="button"
                  :disabled="busy"
                  @click="commitItems"
                >
                  确认入库
                </button>
              </div>
              <div class="notice">每批最多100套、2000张、500MB；每套2至50张，单张不超过20MB。</div>
            </section>
            <section class="panel side-section">
              <div class="side-title">导入批次记录</div>
              <div v-if="historyError" class="empty">{{ historyError }}</div>
              <div v-else-if="!historyRows.length" class="empty">还没有导入批次</div>
              <button
                v-for="batch in historyRows"
                :key="batch.id"
                class="history-row"
                type="button"
                @click="loadBatch(batch.id)"
              >
                <strong>{{ batch.batchNo }}</strong
                ><span class="history-meta"
                  >{{ batch.batchType === 'CUSTOMER' ? '客户素材' : '公司素材' }} ·
                  {{ batch.totalItems }}套 · {{ statusText(batch.status) }}<br />{{
                    formatTime(batch.createdAt)
                  }}</span
                >
              </button>
            </section>
          </aside>
        </div>
      </div>
    </main>
    <div v-if="notice" class="toast">{{ notice }}</div>
  </div>
</template>
