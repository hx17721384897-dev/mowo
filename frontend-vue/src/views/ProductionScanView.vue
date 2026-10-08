<script setup lang="ts">
/* eslint-disable vue/html-closing-bracket-newline, vue/html-indent, vue/multiline-html-element-content-newline */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AdminSidebar from '@/components/AdminSidebar.vue'
import { useBarcodeScanner, type ScanHandler } from '@/features/production-scan/use-barcode-scanner'
import {
  completeFramePack,
  createMaterialPick,
  downloadProductionLedger,
  loadFrameQueue as fetchFrameQueue,
  loadMaterialPicks as fetchMaterialPicks,
  loadMaterialSource,
  loadPacking as fetchPacking,
  loadPackingSessions,
  loadScanOverview,
  lookupCode,
  pairUnit,
  scanPackingUnit as submitPackingUnit,
  shipPackingOrder,
  type FrameQueue,
  type LookupResult,
  type MaterialPick,
  type MaterialSource,
  type PackingData,
  type PackingSession,
  type ScanOverview
} from '@/features/production-scan/api'
import './production-scan.css'

type Station = 'overview' | 'frame' | 'material' | 'pairing' | 'packing'
type HistoryRow = {
  code: string
  specification: string
  source?: string
  time: string
  repeated?: boolean
  repeats?: number
}
type ResultBox = { kind: '' | 'ok' | 'warning' | 'error'; lines: string[] }

const route = useRoute(),
  router = useRouter()
const stationNames: Record<Station, string> = {
  overview: '扫码作业总览',
  frame: '帧包完成',
  material: '材料领用',
  pairing: '单件配对',
  packing: '装箱发货'
}
const batchKey = 'mowo_production_active_batch',
  historyKey = 'mowo_production_scan_history'
const legacyStation =
  String(route.query.station || '') || (route.query.tab === 'pair' ? 'pairing' : '')
const initialStation = (route.hash.slice(1) || legacyStation) as Station
const station = ref<Station>(stationNames[initialStation] ? initialStation : 'overview')
const mobileOpen = ref(false),
  collapsed = ref(false),
  busy = ref(false),
  notice = ref(''),
  noticeError = ref(false)
const batchId = ref(sessionStorage.getItem(batchKey) || '')
const overview = ref<ScanOverview | null>(null),
  queue = ref<FrameQueue | null>(null)
const materialPicks = ref<MaterialPick[]>([]),
  materialSource = ref<{ code: string; info: LookupResult } | null>(null),
  materialQuantity = ref(1)
const pairingSource = ref<MaterialSource | null>(null)
const packingData = ref<PackingData | null>(null),
  trackingNo = ref(''),
  packingSessions = ref<PackingSession[]>([])
const frameManual = ref(''),
  materialManual = ref(''),
  pairingManual = ref(''),
  packingManual = ref('')
const frameResult = ref<ResultBox>({ kind: '', lines: ['等待扫描帧素材包'] })
const materialResult = ref<ResultBox>({ kind: '', lines: ['等待扫描材料来源'] })
const pairingSourceResult = ref<ResultBox>({ kind: '', lines: ['等待扫描材料来源'] })
const pairingResult = ref<ResultBox>({ kind: '', lines: ['尚未开始配对'] })
let noticeTimer: number | undefined

function loadHistory(): Record<string, HistoryRow[]> {
  try {
    return JSON.parse(sessionStorage.getItem(historyKey) || '{}')
  } catch {
    return {}
  }
}
const history = ref(loadHistory())
const frameHistory = computed(() => history.value.frame || [])
const pairingHistory = computed(() => history.value.pairing || [])
const activeBatch = computed(() =>
  overview.value?.batches.find((batch) => batch.id === batchId.value)
)
const currentQueue = computed(() =>
  queue.value?.queue.find((row) => row.frameStatus !== 'COMPLETED')
)
const activePicks = computed(() =>
  materialPicks.value.filter((row) => row.status === 'ACTIVE' && row.remainingQty > 0)
)
const packedCount = computed(
  () => packingData.value?.units.filter((row) => row.scanned).length || 0
)
const pairedCount = computed(() => packingData.value?.units.filter((row) => row.paired).length || 0)

function flash(message: string, error = false) {
  notice.value = message
  noticeError.value = error
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => (notice.value = ''), 2800)
}
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作失败'
}
function beep(kind: boolean | 'warn') {
  try {
    const AudioContextClass = window.AudioContext
    const context = new AudioContextClass(),
      oscillator = context.createOscillator(),
      gain = context.createGain(),
      warning = kind === 'warn'
    oscillator.frequency.value = warning ? 520 : kind ? 880 : 190
    gain.gain.value = 0.06
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + (warning ? 0.14 : kind ? 0.09 : 0.22))
  } catch {
    // Browsers may block sound until the first user gesture; scanning still continues.
  }
}
function classify(code: string) {
  const value = code.trim().toUpperCase()
  if (value.startsWith('FP-')) return 'FRAME'
  if (value.startsWith('KB-') || value.startsWith('LEGACY-KIT-')) return 'KIT_BATCH'
  if (value.startsWith('BX-')) return 'KIT_BOX'
  return 'TRACKING'
}
function requireBatch() {
  if (!batchId.value) throw new Error('请先选择当前生产批次')
  return batchId.value
}
function remember(name: 'frame' | 'pairing', item: HistoryRow) {
  const list = [...(history.value[name] || [])]
  const existing = list.find((row) => row.code === item.code)
  if (existing) Object.assign(existing, item, { repeats: Number(existing.repeats || 0) + 1 })
  else list.unshift({ ...item, repeats: item.repeated ? 1 : 0 })
  history.value = { ...history.value, [name]: list.slice(0, 20) }
  sessionStorage.setItem(historyKey, JSON.stringify(history.value))
}
async function withFeedback(action: () => Promise<void>) {
  if (busy.value) return flash('上一条扫码仍在处理中', true)
  busy.value = true
  try {
    await action()
  } catch (error) {
    flash(errorMessage(error), true)
    beep(false)
  } finally {
    busy.value = false
  }
}
async function refreshOverview() {
  overview.value = await loadScanOverview()
  if (batchId.value && !overview.value.batches.some((batch) => batch.id === batchId.value)) {
    batchId.value = ''
    sessionStorage.removeItem(batchKey)
    clearBatchState()
  }
}
function clearBatchState() {
  queue.value = null
  materialPicks.value = []
  materialSource.value = null
  pairingSource.value = null
  packingSessions.value = []
  clearPacking()
}
async function changeBatch() {
  pairingSource.value = null
  materialSource.value = null
  clearPacking()
  if (batchId.value) sessionStorage.setItem(batchKey, batchId.value)
  else sessionStorage.removeItem(batchKey)
  if (!batchId.value) clearBatchState()
  await refreshStation()
}
async function showStation(next: Station) {
  station.value = next
  await router.replace({ hash: `#${next}` })
  await withFeedback(refreshStation)
}
async function refreshStation() {
  if (station.value === 'overview') return
  if (!batchId.value) return
  if (station.value === 'frame') queue.value = await fetchFrameQueue(requireBatch())
  if (station.value === 'material' || station.value === 'pairing')
    materialPicks.value = await fetchMaterialPicks(requireBatch())
  if (station.value === 'packing') packingSessions.value = await loadPackingSessions(requireBatch())
}
async function scanFrame(code: string) {
  const normalized = code.trim().toUpperCase()
  if (classify(normalized) !== 'FRAME') throw new Error('帧包完成环节只能扫描 FP')
  const info = await lookupCode(normalized)
  const data = await completeFramePack(normalized, requireBatch())
  const repeated = data.reused
  frameResult.value = {
    kind: repeated ? 'warning' : 'ok',
    lines: [
      normalized,
      `${info.productionNo || ''} · ${info.specification || ''}`,
      data.advanced
        ? `已经进入${data.frame.status}，本次未重复登记`
        : repeated
          ? '此前已经完成，本次未重复登记'
          : '本次登记成功'
    ]
  }
  remember('frame', {
    code: normalized,
    specification: info.specification || '',
    time: new Date().toISOString(),
    repeated
  })
  beep(repeated ? 'warn' : true)
  flash(repeated ? '此前已经完成，未重复登记' : '帧包已完成')
  queue.value = await fetchFrameQueue(requireBatch())
  await refreshOverview()
}
async function scanMaterial(code: string) {
  requireBatch()
  const normalized = code.trim().toUpperCase(),
    type = classify(normalized)
  if (!['KIT_BATCH', 'KIT_BOX'].includes(type)) throw new Error('材料领用环节只能扫描 KB 或 BX')
  const info = await lookupCode(normalized)
  materialSource.value = { code: normalized, info }
  materialQuantity.value = Math.min(
    Math.max(1, materialQuantity.value || 1),
    Number(info.freeQty || 1)
  )
  materialResult.value = {
    kind: 'ok',
    lines: [
      normalized,
      `${info.skuCode || 'SKU编码缺失'} · ${info.specification || ''}`,
      `当前可领 ${Number(info.freeQty || 0)} 套`
    ]
  }
  beep(true)
}
async function confirmMaterialPick() {
  const source = materialSource.value
  if (!source) return
  await createMaterialPick(requireBatch(), source.code, Number(materialQuantity.value))
  flash('材料领用成功')
  beep(true)
  materialSource.value = null
  materialResult.value = { kind: '', lines: ['等待扫描下一批材料来源。'] }
  materialPicks.value = await fetchMaterialPicks(requireBatch())
  await refreshOverview()
}
async function scanPairing(code: string) {
  const normalized = code.trim().toUpperCase(),
    type = classify(normalized),
    currentBatch = requireBatch()
  if (type === 'KIT_BATCH' || type === 'KIT_BOX') {
    if (pairingSource.value?.code === normalized) {
      pairingSourceResult.value = {
        kind: 'warning',
        lines: [normalized, '当前已经是这个材料来源，无需重复切换']
      }
      return beep('warn')
    }
    pairingSource.value = await loadMaterialSource(normalized, currentBatch)
    const source = pairingSource.value
    pairingSourceResult.value = {
      kind: 'ok',
      lines: [
        normalized,
        `${source.skuCode} · ${source.specification || ''}`,
        `已领 ${source.pickedQty} · 已配 ${source.consumedQty} · 剩余 ${source.remainingQty}`
      ]
    }
    pairingResult.value = { kind: '', lines: ['材料来源已锁定，请连续扫描同规格 FP。'] }
    return beep(true)
  }
  if (type !== 'FRAME') throw new Error('单件配对环节只能扫描 KB、BX 或 FP')
  if (!pairingSource.value) throw new Error('请先扫描本批次已经领用的 KB 或 BX')
  const info = await lookupCode(normalized)
  const data = await pairUnit(currentBatch, normalized, pairingSource.value.code)
  pairingResult.value = {
    kind: data.reused ? 'warning' : 'ok',
    lines: [
      normalized,
      `${info.productionNo || ''} · ${info.specification || ''}`,
      data.reused
        ? `此前已经与 ${data.sourceCode} 配对，本次未扣库存`
        : `已与 ${pairingSource.value.code} 配对并消耗一套材料包`
    ]
  }
  remember('pairing', {
    code: normalized,
    source: pairingSource.value.code,
    specification: info.specification || '',
    time: new Date().toISOString(),
    repeated: data.reused
  })
  beep(data.reused ? 'warn' : true)
  materialPicks.value = await fetchMaterialPicks(currentBatch)
  await refreshOverview()
}
async function scanPacking(code: string) {
  requireBatch()
  const normalized = code.trim()
  if (classify(normalized) === 'FRAME') {
    if (!trackingNo.value) throw new Error('请先扫描快递面单')
    const data = await submitPackingUnit(trackingNo.value, requireBatch(), normalized.toUpperCase())
    flash(data.complete ? '整单已经配齐' : '本件已装箱')
    beep(true)
    await openPacking(trackingNo.value)
    await refreshOverview()
    return
  }
  await openPacking(normalized)
  beep(true)
}
async function openPacking(value: string) {
  trackingNo.value = value
  packingData.value = await fetchPacking(value, requireBatch())
  packingSessions.value = await loadPackingSessions(requireBatch())
}
function clearPacking() {
  trackingNo.value = ''
  packingData.value = null
}
async function shipOrder() {
  if (!window.confirm('确认箱内产品已经核对并交付快递？')) return
  const data = await shipPackingOrder(trackingNo.value)
  flash(`${data.orderNo} 已发货`)
  beep(true)
  clearPacking()
  await refreshOverview()
  packingSessions.value = await loadPackingSessions(requireBatch())
}
const dispatchScan: ScanHandler = async (code) => {
  await withFeedback(async () => {
    if (station.value === 'frame') return scanFrame(code)
    if (station.value === 'material') return scanMaterial(code)
    if (station.value === 'pairing') return scanPairing(code)
    if (station.value === 'packing') return scanPacking(code)
    throw new Error('请先进入一个具体扫码环节')
  })
}
const scannerHandler = ref<ScanHandler>(dispatchScan)
useBarcodeScanner(scannerHandler, () => flash('上一条扫码仍在处理中', true))
function submitManual(field: typeof frameManual) {
  const code = field.value.trim()
  if (!code) return
  field.value = ''
  void dispatchScan(code)
}
const submitFrameManual = () => submitManual(frameManual)
const submitMaterialManual = () => submitManual(materialManual)
const submitPairingManual = () => submitManual(pairingManual)
const submitPackingManual = () => submitManual(packingManual)
async function downloadLedger() {
  await withFeedback(async () => {
    const id = requireBatch(),
      blob = await downloadProductionLedger(id),
      url = URL.createObjectURL(blob),
      anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${id}_批次生产总表.xlsx`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  })
}
async function downloadQueueFile(item: NonNullable<FrameQueue['queue'][number]>) {
  if (!item.downloadUrl || !/^https?:\/\//i.test(item.downloadUrl))
    return flash('下载地址不可用', true)
  await withFeedback(async () => {
    const response = await fetch(item.downloadUrl!)
    if (!response.ok) throw new Error('生产文件下载失败')
    const url = URL.createObjectURL(await response.blob()),
      anchor = document.createElement('a')
    anchor.href = url
    anchor.download = item.fileName || '生产文件.docx'
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  })
}
function formatTime(value: string) {
  return value ? new Date(value).toLocaleString('zh-CN') : '-'
}

watch(
  () => route.hash,
  (hash) => {
    const next = hash.slice(1) as Station
    if (stationNames[next] && next !== station.value) {
      station.value = next
      void withFeedback(refreshStation)
    }
  }
)
onMounted(async () => {
  await withFeedback(async () => {
    await refreshOverview()
    await refreshStation()
  })
})
onBeforeUnmount(() => window.clearTimeout(noticeTimer))
</script>

<template>
  <div class="production-scan-page" :data-station="station">
    <AdminSidebar v-model:collapsed="collapsed" v-model:mobile-open="mobileOpen" />
    <main class="main" :class="{ expanded: collapsed }">
      <header class="topbar">
        <button class="menu-btn" type="button" aria-label="打开菜单" @click="mobileOpen = true">
          ☰
        </button>
        <h1 id="stationTitle">{{ stationNames[station] }}</h1>
        <div class="scan-ready"><span class="scan-dot"></span>扫码枪已就绪</div>
      </header>
      <div class="content">
        <section class="batch-toolbar">
          <label for="globalBatch">生产批次</label>
          <select
            id="globalBatch"
            v-model="batchId"
            class="select"
            aria-label="生产批次"
            @change="withFeedback(changeBatch)"
          >
            <option value="">请选择生产批次</option>
            <option v-for="batch in overview?.batches || []" :key="batch.id" :value="batch.id">
              {{ batch.id }} · {{ batch.paired }}/{{ batch.total }} 已配对
            </option>
          </select>
          <span id="batchSelectionState" class="batch-count">{{
            activeBatch ? `${activeBatch.total} 件` : '未选择'
          }}</span>
        </section>
        <nav class="work-tabs" aria-label="扫码环节">
          <button
            v-for="(name, key) in stationNames"
            :key="key"
            type="button"
            :data-station="key"
            :class="{ active: station === key }"
            @click="showStation(key)"
          >
            <span class="step-index">{{
              key === 'overview'
                ? '总'
                : { frame: '1', material: '2', pairing: '3', packing: '4' }[key]
            }}</span
            ><span>{{ key === 'overview' ? '作业总览' : name }}</span>
          </button>
        </nav>

        <section v-if="station === 'overview'" class="work-view" data-view="overview">
          <div class="cards">
            <div class="card frame-card">
              <span>帧包完成</span><strong>{{ activeBatch?.frameCompleted || 0 }}</strong>
            </div>
            <div class="card material-card">
              <span>材料已领</span><strong>{{ activeBatch?.materialPicked || 0 }}</strong>
            </div>
            <div class="card pairing-card">
              <span>已经配对</span><strong>{{ activeBatch?.paired || 0 }}</strong>
            </div>
            <div class="card packing-card">
              <span>完成装箱</span><strong>{{ activeBatch?.packaged || 0 }}</strong>
            </div>
          </div>
          <div class="overview-grid">
            <section class="panel">
              <div class="panel-head"><h2>批次进度</h2></div>
              <div class="panel-body">
                <template v-if="activeBatch"
                  ><div class="progress-line">
                    <span>帧包 {{ activeBatch.frameCompleted }}/{{ activeBatch.total }}</span
                    ><span>领料 {{ activeBatch.materialPicked }}/{{ activeBatch.total }}</span
                    ><span>配对 {{ activeBatch.paired }}/{{ activeBatch.total }}</span
                    ><span>装箱 {{ activeBatch.packaged }}/{{ activeBatch.total }}</span>
                  </div>
                  <div class="actions">
                    <RouterLink
                      class="btn link-btn"
                      :to="`/admin/production-batches?batchId=${encodeURIComponent(activeBatch.id)}`"
                      >查看批次详情</RouterLink
                    ><button class="btn" type="button" @click="downloadLedger">
                      下载最新生产总表
                    </button>
                  </div></template
                >
                <div v-else class="empty">请先选择生产批次</div>
              </div>
            </section>
            <section class="panel">
              <div class="panel-head"><h2>最近操作</h2></div>
              <div class="panel-body compact-list">
                <div
                  v-for="row in (overview?.recent || []).slice(0, 12)"
                  :key="`${row.createdAt}-${row.targetId}`"
                  class="row"
                >
                  <div>
                    <div class="row-title">{{ row.action || '生产操作' }}</div>
                    <div class="row-meta">{{ formatTime(row.createdAt) }}</div>
                  </div>
                </div>
                <div v-if="!overview?.recent.length" class="empty">暂无记录</div>
              </div>
            </section>
          </div>
        </section>

        <section v-if="station === 'frame'" class="work-view" data-view="frame">
          <div class="station-grid">
            <div class="station-primary">
              <section class="panel scan-panel">
                <div class="panel-head">
                  <div>
                    <span class="eyebrow">工序 1</span>
                    <h2>扫描帧素材包</h2>
                  </div>
                </div>
                <div class="panel-body">
                  <div class="scan-instruction">裁切、装袋并贴好标签后，扫描 FP 码</div>
                  <div class="field">
                    <label for="frameManual">手工输入</label>
                    <div class="scan-row">
                      <input
                        id="frameManual"
                        v-model="frameManual"
                        class="input code"
                        placeholder="FP-..."
                        @keydown.enter.prevent="submitFrameManual"
                      /><button class="btn btn-black" type="button" @click="submitFrameManual">
                        登记完成
                      </button>
                    </div>
                  </div>
                  <div id="frameResult" class="result result-main" :class="frameResult.kind">
                    <template v-for="(line, index) in frameResult.lines" :key="line"
                      ><strong
                        v-if="index === 0 && frameResult.lines.length > 1"
                        class="code-big"
                        >{{ line }}</strong
                      ><span v-else>{{ line }}</span
                      ><br v-if="index < frameResult.lines.length - 1"
                    /></template>
                  </div>
                </div>
              </section>
              <section class="panel">
                <div class="panel-head"><h2>最近完成</h2></div>
                <div class="panel-body compact-list">
                  <div v-for="row in frameHistory" :key="row.code" class="row">
                    <div>
                      <div class="row-title">{{ row.code }}</div>
                      <div class="row-meta">
                        {{ row.specification }} · {{ formatTime(row.time)
                        }}<span v-if="row.repeats"> · 重复扫描 {{ row.repeats }} 次</span>
                      </div>
                    </div>
                    <span class="badge" :class="row.repeats ? 'warn' : 'ok'">{{
                      row.repeats ? '未重复登记' : '已完成'
                    }}</span>
                  </div>
                  <div v-if="!frameHistory.length" class="empty">暂无记录</div>
                </div>
              </section>
            </div>
            <section class="panel queue-panel">
              <div class="panel-head">
                <div>
                  <h2>打印队列</h2>
                  <div class="panel-meta">按生产顺序排列</div>
                </div>
                <button
                  class="btn"
                  type="button"
                  @click="
                    withFeedback(async () => {
                      queue = await fetchFrameQueue(requireBatch())
                    })
                  "
                >
                  刷新
                </button>
              </div>
              <div class="panel-body">
                <div id="queueCurrent" class="queue-current" :class="{ active: currentQueue }">
                  <template v-if="currentQueue"
                    ><div>
                      <span>当前任务 {{ String(currentQueue.sequence).padStart(4, '0') }}</span
                      ><strong
                        >{{ currentQueue.productionNo }} · {{ currentQueue.specification }}</strong
                      ><small
                        >{{ currentQueue.framePackCode || '尚未生成 FP' }} ·
                        {{ currentQueue.pageCount || '?' }} 页</small
                      >
                    </div>
                    <button
                      v-if="currentQueue.downloadUrl"
                      class="btn btn-black"
                      type="button"
                      @click="downloadQueueFile(currentQueue)"
                    >
                      下载当前 Word
                    </button></template
                  ><template v-else>{{
                    batchId ? '当前批次的帧包任务已经全部完成' : '请先选择生产批次'
                  }}</template>
                </div>
                <div class="queue-list">
                  <div
                    v-for="item in queue?.queue || []"
                    :key="item.productionUnitId"
                    class="queue-item"
                    :class="{ done: item.frameStatus === 'COMPLETED' }"
                  >
                    <div class="queue-seq">{{ String(item.sequence).padStart(4, '0') }}</div>
                    <div>
                      <div class="row-title">
                        {{ item.productionNo }} · {{ item.framePackCode || '尚未生成 FP' }}
                      </div>
                      <div class="row-meta">
                        {{ item.groupName }} · {{ item.specification }} ·
                        {{ item.pageCount || '?' }} 页
                      </div>
                    </div>
                    <span class="badge" :class="item.frameStatus === 'COMPLETED' ? 'ok' : 'warn'">{{
                      item.frameStatus === 'COMPLETED' ? '已完成' : '待处理'
                    }}</span
                    ><button
                      v-if="item.downloadUrl"
                      class="btn"
                      type="button"
                      @click="downloadQueueFile(item)"
                    >
                      下载
                    </button>
                  </div>
                  <div v-if="batchId && !queue?.queue.length" class="empty">当前没有打印任务</div>
                </div>
              </div>
            </section>
          </div>
        </section>

        <section v-if="station === 'material'" class="work-view" data-view="material">
          <div class="station-grid">
            <section class="panel scan-panel">
              <div class="panel-head">
                <div>
                  <span class="eyebrow">工序 2</span>
                  <h2>领取材料包</h2>
                </div>
              </div>
              <div class="panel-body">
                <div class="scan-instruction">扫描材料批次码 KB 或箱码 BX</div>
                <div class="field">
                  <label for="materialManual">手工输入</label>
                  <div class="scan-row">
                    <input
                      id="materialManual"
                      v-model="materialManual"
                      class="input code"
                      placeholder="KB-... / BX-..."
                      @keydown.enter.prevent="submitMaterialManual"
                    /><button class="btn" type="button" @click="submitMaterialManual">读取</button>
                  </div>
                </div>
                <div
                  id="materialSourceResult"
                  class="result result-main"
                  :class="materialResult.kind"
                >
                  <template v-for="line in materialResult.lines" :key="line"
                    ><span>{{ line }}</span
                    ><br
                  /></template>
                </div>
                <div class="quantity-row">
                  <div class="field">
                    <label for="materialQuantity">领取数量</label
                    ><input
                      id="materialQuantity"
                      v-model.number="materialQuantity"
                      class="input"
                      type="number"
                      min="1"
                      :max="materialSource?.info.freeQty || undefined"
                    />
                  </div>
                  <button
                    class="btn btn-black"
                    type="button"
                    :disabled="!materialSource || Number(materialSource.info.freeQty || 0) < 1"
                    @click="withFeedback(confirmMaterialPick)"
                  >
                    确认领用
                  </button>
                </div>
              </div>
            </section>
            <section class="panel">
              <div class="panel-head">
                <div>
                  <h2>领料记录</h2>
                  <div class="panel-meta">当前生产批次</div>
                </div>
              </div>
              <div class="panel-body compact-list">
                <div v-for="row in materialPicks" :key="row.id" class="row">
                  <div>
                    <div class="row-title">{{ row.sourceCode }} · {{ row.quantity }} 套</div>
                    <div class="row-meta">
                      剩余 {{ row.remainingQty }} · 已配对 {{ row.consumedQty }} · 已退
                      {{ row.returnedQty }}
                    </div>
                  </div>
                  <span class="badge" :class="row.remainingQty ? 'warn' : 'ok'">{{
                    row.remainingQty ? '待配对' : row.status
                  }}</span>
                </div>
                <div v-if="!materialPicks.length" class="empty">
                  {{ batchId ? '本批次还没有领料记录' : '请先选择生产批次' }}
                </div>
              </div>
            </section>
          </div>
        </section>

        <section v-if="station === 'pairing'" class="work-view" data-view="pairing">
          <div class="station-grid">
            <section class="panel scan-panel">
              <div class="panel-head">
                <div>
                  <span class="eyebrow">工序 3</span>
                  <h2>单件配对</h2>
                </div>
              </div>
              <div class="panel-body">
                <div class="scan-instruction">先扫描材料来源 KB/BX，再连续扫描对应 FP</div>
                <div class="result source-result" :class="pairingSourceResult.kind">
                  <template v-for="line in pairingSourceResult.lines" :key="line"
                    ><span>{{ line }}</span
                    ><br
                  /></template>
                </div>
                <div class="field">
                  <label for="pairingManual">手工输入</label>
                  <div class="scan-row">
                    <input
                      id="pairingManual"
                      v-model="pairingManual"
                      class="input code"
                      placeholder="KB / BX / FP"
                      @keydown.enter.prevent="submitPairingManual"
                    /><button class="btn btn-black" type="button" @click="submitPairingManual">
                      处理
                    </button>
                  </div>
                </div>
                <div class="result result-main" :class="pairingResult.kind">
                  <template v-for="line in pairingResult.lines" :key="line"
                    ><span>{{ line }}</span
                    ><br
                  /></template>
                </div>
              </div>
            </section>
            <div class="station-secondary">
              <section class="panel">
                <div class="panel-head"><h2>可配材料</h2></div>
                <div class="panel-body source-list">
                  <div v-for="row in activePicks" :key="row.id" class="source-card">
                    <strong>{{ row.sourceCode }}</strong
                    ><span
                      >已领 {{ row.quantity }} · 已配 {{ row.consumedQty }} · 剩余
                      {{ row.remainingQty }}</span
                    >
                  </div>
                  <div v-if="!activePicks.length" class="empty">
                    {{ batchId ? '当前批次没有可配对的已领材料' : '请先选择生产批次' }}
                  </div>
                </div>
              </section>
              <section class="panel">
                <div class="panel-head"><h2>最近配对</h2></div>
                <div class="panel-body compact-list">
                  <div v-for="row in pairingHistory" :key="row.code" class="row">
                    <div>
                      <div class="row-title">{{ row.code }}</div>
                      <div class="row-meta">
                        {{ row.specification }}<br />{{ row.source }} · {{ formatTime(row.time)
                        }}<span v-if="row.repeats"> · 重复 {{ row.repeats }} 次</span>
                      </div>
                    </div>
                    <span class="badge" :class="row.repeats ? 'warn' : 'ok'">{{
                      row.repeats ? '未重复扣减' : '已配对'
                    }}</span>
                  </div>
                  <div v-if="!pairingHistory.length" class="empty">暂无记录</div>
                </div>
              </section>
            </div>
          </div>
        </section>

        <section v-if="station === 'packing'" class="work-view" data-view="packing">
          <div class="station-grid">
            <section class="panel scan-panel">
              <div class="panel-head">
                <div>
                  <span class="eyebrow">工序 4</span>
                  <h2>装箱发货</h2>
                </div>
              </div>
              <div class="panel-body">
                <div class="scan-instruction">先扫描快递面单，再逐件扫描 FP</div>
                <div class="field">
                  <label for="packingManual">手工输入</label>
                  <div class="scan-row">
                    <input
                      id="packingManual"
                      v-model="packingManual"
                      class="input code"
                      placeholder="快递单号 / FP-..."
                      @keydown.enter.prevent="submitPackingManual"
                    /><button class="btn btn-black" type="button" @click="submitPackingManual">
                      处理
                    </button>
                  </div>
                </div>
                <div class="result result-main">
                  <template v-if="packingData"
                    ><strong class="code-big">{{ trackingNo }}</strong
                    ><br /><strong
                      >{{ packingData.order.orderNo }} ·
                      {{ packingData.order.receiverName }}</strong
                    >
                    <div class="summary">
                      <div class="sum">
                        <b>{{ packingData.units.length }}</b
                        ><span>应有产品</span>
                      </div>
                      <div class="sum">
                        <b>{{ pairedCount }}</b
                        ><span>已经配对</span>
                      </div>
                      <div class="sum">
                        <b>{{ packedCount }}</b
                        ><span>已经装箱</span>
                      </div>
                      <div class="sum">
                        <b>{{ packingData.units.length - packedCount }}</b
                        ><span>仍缺</span>
                      </div>
                    </div>
                    <div
                      v-for="unit in packingData.units"
                      :key="unit.productionUnitId"
                      class="unit"
                      :class="{ done: unit.scanned, blocked: !unit.scanned && !unit.paired }"
                    >
                      <div>
                        <div class="unit-no">{{ unit.productionNo }}</div>
                        <div class="unit-spec">{{ unit.specification }}</div>
                      </div>
                      <span class="badge">{{
                        unit.scanned ? '已装箱' : unit.paired ? '等待扫描' : '尚未配对'
                      }}</span>
                    </div>
                    <div class="actions">
                      <button
                        class="btn btn-black"
                        type="button"
                        :disabled="!packingData.complete"
                        @click="withFeedback(shipOrder)"
                      >
                        确认交付快递并发货</button
                      ><button class="btn" type="button" @click="clearPacking">结束当前箱</button>
                    </div></template
                  ><template v-else>等待扫描快递面单</template>
                </div>
              </div>
            </section>
            <section class="panel">
              <div class="panel-head"><h2>待齐套订单</h2></div>
              <div class="panel-body compact-list">
                <div v-for="row in packingSessions" :key="row.id" class="row">
                  <div>
                    <div class="row-title">{{ row.orderNo }} · {{ row.receiverName }}</div>
                    <div class="row-meta">
                      {{ row.trackingNo }} · 已装箱 {{ row.scanned }}/{{ row.total }}
                    </div>
                  </div>
                  <button
                    class="btn"
                    type="button"
                    @click="withFeedback(() => openPacking(row.trackingNo))"
                  >
                    继续
                  </button>
                </div>
                <div v-if="!packingSessions.length" class="empty">
                  {{ batchId ? '当前批次没有等待齐套的订单' : '请先选择生产批次' }}
                </div>
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
    <div v-if="notice" class="toast" :class="{ error: noticeError }">{{ notice }}</div>
  </div>
</template>
