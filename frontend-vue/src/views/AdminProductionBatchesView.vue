<script setup lang="ts">
/* eslint-disable vue/html-closing-bracket-newline, vue/html-indent, vue/multiline-html-element-content-newline */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AdminSidebar from '@/components/AdminSidebar.vue'
import { runtimeConfig } from '@/config/runtime'
import { ApiError } from '@/services/api-client'
import {
  createProductionBatch,
  getProductionBatch,
  listBatchCandidates,
  listProductionBatches,
  type BatchDetail,
  type BatchSummary,
  type Candidate,
  type CandidateFilters,
  type CandidateMeta
} from '@/features/admin-production-batches/api'
import './admin-production-batches.css'

const route = useRoute(),
  router = useRouter()
const mobileOpen = ref(false),
  collapsed = ref(false),
  loading = ref(true),
  detailLoading = ref(false)
const error = ref(''),
  notice = ref(''),
  batches = ref<BatchSummary[]>([]),
  detail = ref<BatchDetail | null>(null)
const activeBatchId = ref(''),
  modalOpen = ref(false),
  candidateLoading = ref(false),
  creating = ref(false)
const candidates = ref<Candidate[]>([]),
  selected = ref<string[]>([])
const emptyMeta: CandidateMeta = {
  totalOrders: 0,
  totalUnits: 0,
  models: [],
  skus: [],
  sizes: [],
  frameCounts: [],
  printGroups: []
}
const candidateMeta = ref<CandidateMeta>(emptyMeta)
const filters = reactive<CandidateFilters>({
  paidFrom: '',
  paidTo: '',
  orderNo: '',
  platform: '',
  modelId: '',
  skuId: '',
  size: '',
  frameCount: '',
  printGroupId: '',
  readyOnly: false,
  kitAvailableOnly: false
})
const requestStorageKey = 'mowo.productionBatch.pendingRequest'
let noticeTimer: number | undefined,
  listSequence = 0,
  detailSequence = 0

const stats = computed(() => ({
  total: batches.value.length,
  ready: batches.value.filter((x) => x.status === 'READY').length,
  progress: batches.value.filter((x) => x.status === 'IN_PROGRESS').length,
  exceptions: batches.value.reduce((n, x) => n + (x.progress?.exceptions || 0), 0)
}))
const selectedRows = computed(() =>
  candidates.value.filter((row) => selected.value.includes(row.id))
)
const selectedUnits = computed(() =>
  selectedRows.value.reduce((n, row) => n + row.productionUnitCount, 0)
)
const selectedPages = computed(() =>
  selectedRows.value.reduce((n, row) => n + row.estimatedPrintPages, 0)
)
const selectedUnknown = computed(() =>
  selectedRows.value.reduce((n, row) => n + (row.unconfiguredPrintUnitCount || 0), 0)
)
const productionFiles = computed(() => detail.value?.productionFiles ?? [])

const statusText: Record<string, string> = {
  READY: '已创建',
  IN_PROGRESS: '生产中',
  COMPLETED: '生产完成',
  ARCHIVED: '已归档',
  Open: '旧批次',
  Locked: '旧批次',
  Processing: '旧批次'
}
const stateText: Record<string, string> = {
  WAITING: '待处理',
  COMPLETED: '已完成',
  PICKED: '已领取',
  NORMAL: '正常',
  IN_PROGRESS: '进行中'
}
const fulfillmentText: Record<string, string> = {
  PAID: '已付款',
  PENDING_ADDRESS_EXPORT: '待处理',
  WAITING_TRACKING: '处理中',
  READY_FOR_PRODUCTION: '待生产',
  PRODUCING: '生产中',
  READY_TO_SHIP: '待发货',
  SHIPPED: '已发货'
}
function legacyUrl(file: string) {
  return `${runtimeConfig.legacyWebBase}/${file}`
}
function formatTime(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false })
}
function flash(message: string) {
  notice.value = message
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => (notice.value = ''), 3200)
}
function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : '操作失败'
}
function safeDownloadUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}
function statusClass(status: string) {
  return status === 'READY'
    ? 'badge-ready'
    : status === 'IN_PROGRESS'
      ? 'badge-progress'
      : status === 'COMPLETED'
        ? 'badge-complete'
        : ''
}
function currentStageRoute(orders: BatchDetail['orders']) {
  const priority = [
    'PENDING_ADDRESS_EXPORT',
    'WAITING_TRACKING',
    'READY_FOR_PRODUCTION',
    'PRODUCING',
    'READY_TO_SHIP',
    'SHIPPED'
  ]
  const status =
    priority.find((value) => orders.some((order) => order.fulfillmentStatus === value)) || 'PAID'
  const view: Record<string, string> = {
    PAID: 'paid',
    PENDING_ADDRESS_EXPORT: 'pending',
    WAITING_TRACKING: 'locked',
    READY_FOR_PRODUCTION: 'processing',
    PRODUCING: 'producing',
    READY_TO_SHIP: 'ready',
    SHIPPED: 'shipped'
  }
  return { name: 'admin-orders', query: { view: view[status] } }
}
function reprintFile(id: string | null) {
  return productionFiles.value.find((file) => file.id === id)
}
function frameDone(status: string) {
  return ['COMPLETED', 'PAIRED', 'PACKED', 'SHIPPED'].includes(status)
}
function pairDone(status: string) {
  return ['PAIRED', 'PACKED', 'SHIPPED', 'COMPLETED'].includes(status)
}
function packDone(status: string) {
  return ['PACKED', 'SHIPPED', 'COMPLETED'].includes(status)
}

async function loadBatches() {
  const seq = ++listSequence
  loading.value = true
  error.value = ''
  try {
    const rows = await listProductionBatches()
    if (seq !== listSequence) return
    batches.value = rows
    const queryId = typeof route.query.batchId === 'string' ? route.query.batchId : ''
    if (queryId && rows.some((row) => row.id === queryId)) await selectBatch(queryId)
    else if (activeBatchId.value && !rows.some((row) => row.id === activeBatchId.value)) {
      activeBatchId.value = ''
      detail.value = null
    }
  } catch (cause) {
    if (seq === listSequence) error.value = messageOf(cause)
  } finally {
    if (seq === listSequence) loading.value = false
  }
}
async function selectBatch(id: string) {
  activeBatchId.value = id
  void router.replace({ query: { ...route.query, batchId: id } })
  const seq = ++detailSequence
  detailLoading.value = true
  try {
    const value = await getProductionBatch(id)
    if (seq === detailSequence) detail.value = value
  } catch (cause) {
    if (seq === detailSequence) {
      detail.value = null
      flash(messageOf(cause))
    }
  } finally {
    if (seq === detailSequence) detailLoading.value = false
  }
}
async function openCreate() {
  selected.value = []
  modalOpen.value = true
  document.body.style.overflow = 'hidden'
  await loadCandidates()
}
function closeCreate(force = false) {
  if (creating.value && !force) return
  modalOpen.value = false
  document.body.style.overflow = ''
}
async function loadCandidates() {
  candidateLoading.value = true
  try {
    const result = await listBatchCandidates(filters)
    candidates.value = result.candidates
    candidateMeta.value = result.meta
    selected.value = selected.value.filter((id) =>
      result.candidates.some((row) => row.id === id && row.ready)
    )
  } catch (cause) {
    flash(messageOf(cause))
  } finally {
    candidateLoading.value = false
  }
}
function resetFilters() {
  Object.assign(filters, {
    paidFrom: '',
    paidTo: '',
    orderNo: '',
    platform: '',
    modelId: '',
    skuId: '',
    size: '',
    frameCount: '',
    printGroupId: '',
    readyOnly: false,
    kitAvailableOnly: false
  })
  void loadCandidates()
}
function selectCurrent() {
  selected.value = candidates.value.filter((row) => row.ready).map((row) => row.id)
}
function toggleCandidate(id: string, checked: boolean) {
  selected.value = checked
    ? [...new Set([...selected.value, id])]
    : selected.value.filter((value) => value !== id)
}
function requestId() {
  const selectionKey = [...selected.value].sort().join(',')
  try {
    const saved = JSON.parse(sessionStorage.getItem(requestStorageKey) || 'null') as {
      id?: string
      selectionKey?: string
    } | null
    if (saved?.id && saved.selectionKey === selectionKey) return saved.id
    const id = crypto.randomUUID()
    sessionStorage.setItem(requestStorageKey, JSON.stringify({ id, selectionKey }))
    return id
  } catch {
    return crypto.randomUUID()
  }
}
async function submitBatch(ack = false) {
  if (!selected.value.length || creating.value) return
  creating.value = true
  try {
    const result = await createProductionBatch(selected.value, ack, requestId())
    sessionStorage.removeItem(requestStorageKey)
    closeCreate(true)
    flash(
      result.reused
        ? '已恢复此前创建成功的生产批次'
        : result.artifactErrors.length
          ? '生产批次已创建，部分打印文件生成失败'
          : '生产批次已创建'
    )
    await loadBatches()
    await selectBatch(result.batchId)
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'BATCH_WARNINGS_REQUIRE_ACK') {
      const issues = Array.isArray(cause.details)
        ? cause.details
            .map((value) => (value as { message?: string }).message)
            .filter(Boolean)
            .join('\n')
        : ''
      if (window.confirm(`${cause.message}\n\n${issues}\n\n仍然创建这个生产批次吗？`)) {
        creating.value = false
        return submitBatch(true)
      }
      return
    }
    flash(
      cause instanceof ApiError && cause.code === 'NETWORK_ERROR'
        ? '网络异常，请重试；系统不会重复创建批次'
        : messageOf(cause)
    )
  } finally {
    creating.value = false
  }
}

onMounted(() => void loadBatches())
onBeforeUnmount(() => {
  listSequence++
  detailSequence++
  window.clearTimeout(noticeTimer)
  document.body.style.overflow = ''
})
</script>

<template>
  <div class="admin-production-batches-page">
    <div class="sidebar-backdrop" :class="{ show: mobileOpen }" @click="mobileOpen = false"></div>
    <AdminSidebar
      :mobile-open="mobileOpen"
      @mobile-close="mobileOpen = false"
      @collapse-change="collapsed = $event"
    />
    <main class="main" :class="{ expanded: collapsed }">
      <header class="topbar">
        <div class="top-actions">
          <button class="btn menu-btn" type="button" @click="mobileOpen = true">菜单</button>
          <h1>生产批次</h1>
        </div>
        <div class="top-actions">
          <button class="btn" type="button" :disabled="loading" @click="loadBatches">刷新</button
          ><button class="btn btn-black" type="button" @click="openCreate">创建生产批次</button>
        </div>
      </header>
      <div class="content">
        <div v-if="notice" class="toast show" role="status">{{ notice }}</div>
        <section class="stats" aria-label="生产批次统计">
          <div class="stat">
            <div class="stat-label">全部批次</div>
            <div class="stat-value">{{ stats.total }}</div>
          </div>
          <div class="stat">
            <div class="stat-label">已创建</div>
            <div class="stat-value">{{ stats.ready }}</div>
          </div>
          <div class="stat">
            <div class="stat-label">生产中</div>
            <div class="stat-value">{{ stats.progress }}</div>
          </div>
          <div class="stat">
            <div class="stat-label">异常生产件</div>
            <div class="stat-value">{{ stats.exceptions }}</div>
          </div>
        </section>
        <div v-if="error" class="empty error-state">
          <p>{{ error }}</p>
          <button class="btn" type="button" @click="loadBatches">重新加载</button>
        </div>
        <div v-else class="layout">
          <section class="panel">
            <div class="panel-head">
              <div>
                <div class="panel-title">生产批次</div>
                <div class="panel-sub">按创建时间倒序</div>
              </div>
            </div>
            <div v-if="loading" class="empty">正在加载生产批次...</div>
            <div v-else-if="!batches.length" class="empty">还没有正式生产批次</div>
            <button
              v-for="batch in batches"
              v-else
              :key="batch.id"
              class="batch-row"
              :class="{ active: batch.id === activeBatchId }"
              type="button"
              @click="selectBatch(batch.id)"
            >
              <div>
                <div class="batch-no">{{ batch.id }}</div>
                <div class="batch-meta">
                  {{ formatTime(batch.createdAt) }} · {{ batch.salesOrderCount }} 单 ·
                  {{ batch.productionUnitCount }} 件 · {{ batch.skuCount }} 种 SKU<span
                    v-if="batch.legacy"
                  >
                    · 旧批次</span
                  >
                </div>
              </div>
              <div>
                <span class="badge" :class="statusClass(batch.status)">{{
                  statusText[batch.status] || batch.status
                }}</span>
                <div v-if="batch.warningCount" class="badge badge-warning warning-count">
                  {{ batch.warningCount }} 条提醒
                </div>
              </div>
            </button>
          </section>
          <section id="batchDetail" class="panel">
            <div class="panel-head">
              <div>
                <div class="panel-title">批次详情</div>
                <div class="panel-sub">总订单、打印顺序、材料和并行进度</div>
              </div>
            </div>
            <div v-if="detailLoading" class="empty">正在加载批次详情...</div>
            <div v-else-if="!detail" class="empty">选择左侧批次查看详情</div>
            <div v-else-if="detail.legacy" class="detail-body">
              <div class="detail-title">{{ detail.batch.id }}</div>
              <div class="empty">这是旧流程产生的批次，仅保留只读查询，不能再推动正式订单。</div>
            </div>
            <div v-else class="detail-body">
              <div class="detail-head">
                <div>
                  <div class="detail-title">{{ detail.batch.id }}</div>
                  <div class="detail-meta">
                    {{ formatTime(detail.batch.createdAt) }} ·
                    {{ detail.batch.salesOrderCount }} 个总订单 ·
                    {{ detail.batch.productionUnitCount }} 个生产件
                  </div>
                </div>
                <span class="badge" :class="statusClass(detail.batch.status)">{{
                  statusText[detail.batch.status] || detail.batch.status
                }}</span>
              </div>
              <div class="workflow-actions">
                <RouterLink class="btn btn-black" :to="currentStageRoute(detail.orders)"
                  >进入当前订单环节</RouterLink
                ><a class="btn" :href="legacyUrl('production-scan.html?v=20260904-1#overview')"
                  >进入扫码生产</a
                >
              </div>
              <div class="issue">
                此页只负责查看批次、文件和进度；导出地址、绑定面单、开始生产和返工统一在订单环节页完成。
              </div>
              <section v-if="detail.batch.warnings.length" class="section">
                <h3>创建时提醒</h3>
                <div
                  v-for="warning in detail.batch.warnings"
                  :key="warning.code + warning.message"
                  class="issue warning"
                >
                  {{ warning.message }}
                </div>
              </section>
              <div
                class="ledger-check"
                :class="{ 'has-reprint': detail.ledgerCheck.reprintCount > 0 }"
              >
                <div>
                  <div class="ledger-label">生产清单核对标记</div>
                  <div class="ledger-marker">{{ detail.ledgerCheck.currentMarker }}</div>
                </div>
                <div class="ledger-result">
                  {{
                    detail.ledgerCheck.reprintCount
                      ? `已有 ${detail.ledgerCheck.reprintCount} 次返工；纸面数字不一致即为旧清单`
                      : '当前没有返工记录'
                  }}
                </div>
              </div>
              <div class="progress-grid">
                <div class="progress-item">
                  <div class="progress-num">
                    {{ detail.progress.frameCompleted }}/{{ detail.progress.total }}
                  </div>
                  <div class="progress-label">帧包完成</div>
                </div>
                <div class="progress-item">
                  <div class="progress-num">
                    {{ detail.progress.materialPicked }}/{{ detail.progress.total }}
                  </div>
                  <div class="progress-label">材料已领</div>
                </div>
                <div class="progress-item">
                  <div class="progress-num">
                    {{ detail.progress.paired }}/{{ detail.progress.total }}
                  </div>
                  <div class="progress-label">已经配对</div>
                </div>
                <div class="progress-item">
                  <div class="progress-num">
                    {{ detail.progress.packaged }}/{{ detail.progress.total }}
                  </div>
                  <div class="progress-label">完成装箱</div>
                </div>
                <div class="progress-item">
                  <div class="progress-num">{{ detail.progress.exceptions }}</div>
                  <div class="progress-label">异常</div>
                </div>
              </div>
              <section class="section">
                <h3>帧素材打印顺序</h3>
                <div v-if="!detail.printQueue.length" class="empty compact">没有打印顺序</div>
                <div v-for="row in detail.printQueue" :key="row.productionUnitId" class="print-row">
                  <strong>{{ row.sequence || '—' }}</strong>
                  <div>
                    <strong>{{ row.productionNo }}</strong
                    ><br /><span>{{ row.groupName || '未配置' }}</span>
                  </div>
                  <span>{{ row.rule?.size || '' }} · {{ row.rule?.frameCount || '—' }}帧</span
                  ><span>{{ row.pageCount || '—' }}页</span>
                </div>
              </section>
              <section v-if="detail.reprintTimeline.length" class="section">
                <h3>返工记录与当前进度</h3>
                <article v-for="row in detail.reprintTimeline" :key="row.id" class="reprint-card">
                  <div class="reprint-head">
                    <div>
                      <div class="reprint-title">
                        第 {{ row.revisionNo }} 次返工 · {{ row.productionNo }}
                      </div>
                      <div class="reprint-meta">
                        {{ formatTime(row.createdAt) }} · {{ row.requestedByName }} ·
                        {{ row.specification }}
                      </div>
                    </div>
                    <span class="badge badge-warning"
                      >重印第 {{ row.requestedPages.join('、') }} 页</span
                    >
                  </div>
                  <div class="reprint-detail">{{ row.reason }}</div>
                  <div class="reprint-codes">
                    <span class="reprint-old">{{ row.oldFramePackCode }}</span
                    ><span>→</span><span class="reprint-new">{{ row.newFramePackCode }}</span>
                  </div>
                  <div class="reprint-flow">
                    <div class="reprint-step done">1 返工已登记</div>
                    <div class="reprint-step done">2 旧码已作废</div>
                    <div class="reprint-step done">
                      3
                      <a
                        v-if="safeDownloadUrl(reprintFile(row.productionPrintFileId)?.downloadUrl)"
                        :href="
                          safeDownloadUrl(reprintFile(row.productionPrintFileId)?.downloadUrl)!
                        "
                        >下载重印文件</a
                      ><span v-else>重印文件已生成</span>
                    </div>
                    <div
                      class="reprint-step"
                      :class="{
                        done: frameDone(row.newFramePackStatus),
                        current: !frameDone(row.newFramePackStatus)
                      }"
                    >
                      4 {{ frameDone(row.newFramePackStatus) ? '新帧包已完成' : '等待新帧包完成' }}
                    </div>
                    <div
                      class="reprint-step"
                      :class="{
                        done: pairDone(row.pairingStatus) || packDone(row.packageStatus),
                        current: frameDone(row.newFramePackStatus) && !pairDone(row.pairingStatus)
                      }"
                    >
                      5
                      {{
                        packDone(row.packageStatus)
                          ? '已装箱'
                          : pairDone(row.pairingStatus)
                            ? '已重新配对'
                            : '等待重新配对'
                      }}
                    </div>
                  </div>
                </article>
              </section>
              <section class="section">
                <h3>本批次生产文件</h3>
                <div v-if="!detail.productionFiles.length" class="issue warning">
                  尚未生成可打印 Word。
                </div>
                <div v-for="file in detail.productionFiles" :key="file.id" class="file-row">
                  <div>
                    <strong>{{ file.displayName }}</strong>
                    <div class="panel-sub">
                      {{ file.sourceType === 'REPRINT' ? '返工文件' : '首次生产文件' }} ·
                      {{ file.targetFrameCount }}帧 · {{ formatTime(file.createdAt) }}
                    </div>
                  </div>
                  <a
                    v-if="safeDownloadUrl(file.downloadUrl)"
                    class="btn"
                    :href="safeDownloadUrl(file.downloadUrl)!"
                    >下载</a
                  >
                  <span v-else class="issue error">下载地址不可用</span>
                </div>
              </section>
              <section class="section">
                <h3>标准材料包需求</h3>
                <div class="demand-row demand-head">
                  <span>SKU</span><span>需要</span><span>可用</span><span>已领</span>
                </div>
                <div v-for="row in detail.materialDemand" :key="row.skuId" class="demand-row">
                  <strong>{{ row.skuCode || row.skuId }}</strong
                  ><span>{{ row.required }}</span
                  ><span :class="{ shortage: row.available < row.required }">{{
                    row.available
                  }}</span
                  ><span>{{ row.picked }}</span>
                </div>
              </section>
              <section class="section">
                <h3>总订单与生产件</h3>
                <article v-for="order in detail.orders" :key="order.id" class="order">
                  <div class="order-head">
                    <div>
                      <div class="order-no">{{ order.orderNo }}</div>
                      <div class="order-stage">
                        {{ fulfillmentText[order.fulfillmentStatus] || order.fulfillmentStatus
                        }}<span v-if="order.trackingNo">
                          · {{ order.trackingCompany }} {{ order.trackingNo }}</span
                        >
                      </div>
                      <div class="order-address">
                        {{ order.receiverName }} · {{ order.receiverCity }}
                        {{ order.receiverAddress }}
                      </div>
                    </div>
                    <span class="badge"
                      >{{ order.items.reduce((n, item) => n + item.quantity, 0) }} 件</span
                    >
                  </div>
                  <template v-for="item in order.items" :key="item.id"
                    ><div v-for="unit in item.productionUnits" :key="unit.id" class="unit">
                      <strong
                        >{{ unit.productionNo
                        }}<template v-if="unit.framePack"
                          ><br /><span class="frame-pack">{{ unit.framePack.code }}</span></template
                        ><br /><span class="unit-spec">{{ unit.specification }}</span></strong
                      ><span class="unit-state"
                        >帧包
                        {{
                          stateText[unit.workflow?.frameStatus || ''] ||
                          unit.workflow?.frameStatus ||
                          '—'
                        }}</span
                      ><span class="unit-state"
                        >领料
                        {{
                          stateText[unit.workflow?.materialStatus || ''] ||
                          unit.workflow?.materialStatus ||
                          '—'
                        }}</span
                      ><span class="unit-state"
                        >配对
                        {{
                          stateText[unit.workflow?.pairingStatus || ''] ||
                          unit.workflow?.pairingStatus ||
                          '—'
                        }}</span
                      ><span class="unit-state"
                        >装箱
                        {{
                          stateText[unit.workflow?.packageStatus || ''] ||
                          unit.workflow?.packageStatus ||
                          '—'
                        }}</span
                      >
                    </div></template
                  >
                </article>
              </section>
            </div>
          </section>
        </div>
      </div>
    </main>
    <div v-if="modalOpen" class="overlay show" role="presentation" @click.self="closeCreate()">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="create-batch-title">
        <div class="modal-head">
          <div>
            <div id="create-batch-title" class="panel-title">创建生产批次</div>
            <div class="panel-sub">选择的是完整总订单，订单内所有生产件会一起进入批次</div>
          </div>
          <button class="btn" type="button" :disabled="creating" @click="closeCreate()">
            关闭
          </button>
        </div>
        <div class="filters">
          <input v-model="filters.paidFrom" type="date" aria-label="支付开始日期" /><input
            v-model="filters.paidTo"
            type="date"
            aria-label="支付结束日期"
          /><input v-model="filters.orderNo" placeholder="订单号" aria-label="订单号" /><select
            v-model="filters.platform"
            aria-label="订单来源"
          >
            <option value="">全部来源</option>
            <option value="SELF">本站</option>
            <option value="TAOBAO">淘宝</option>
            <option value="DOUYIN">抖音</option>
            <option value="XHS">小红书</option></select
          ><select v-model="filters.modelId" aria-label="款式">
            <option value="">全部款式</option>
            <option v-for="x in candidateMeta.models" :key="x.id" :value="x.id">
              {{ x.name }}
            </option></select
          ><select v-model="filters.skuId" aria-label="SKU">
            <option value="">全部 SKU</option>
            <option v-for="x in candidateMeta.skus" :key="x.id" :value="x.id">
              {{ x.modelName }} · {{ x.code || `${x.size} ${x.frameCount}帧` }}
            </option></select
          ><select v-model="filters.size" aria-label="尺寸">
            <option value="">全部尺寸</option>
            <option v-for="x in candidateMeta.sizes" :key="x" :value="x">{{ x }}</option></select
          ><select v-model="filters.frameCount" aria-label="帧数">
            <option value="">全部帧数</option>
            <option v-for="x in candidateMeta.frameCounts" :key="x" :value="String(x)">
              {{ x }}帧
            </option></select
          ><select v-model="filters.printGroupId" aria-label="打印裁切组">
            <option value="">全部打印裁切组</option>
            <option v-for="x in candidateMeta.printGroups" :key="x.id" :value="x.id">
              {{ x.name }}
            </option>
          </select>
          <div class="filter-actions">
            <div class="filter-checks">
              <label><input v-model="filters.readyOnly" type="checkbox" /> 只看资料完整</label
              ><label
                ><input v-model="filters.kitAvailableOnly" type="checkbox" /> 只看材料充足</label
              >
            </div>
            <div class="top-actions">
              <button class="btn" type="button" @click="resetFilters">重置</button
              ><button class="btn" type="button" @click="selectCurrent">全选当前结果</button
              ><button
                class="btn btn-black"
                type="button"
                :disabled="candidateLoading"
                @click="loadCandidates"
              >
                筛选
              </button>
            </div>
          </div>
        </div>
        <div class="modal-body">
          <div v-if="candidateLoading" class="empty">正在检查待生产订单...</div>
          <div v-else-if="!candidates.length" class="empty">没有符合条件的待生产总订单</div>
          <label
            v-for="row in candidates"
            v-else
            :key="row.id"
            class="candidate"
            :class="{ disabled: !row.ready }"
            ><input
              type="checkbox"
              :disabled="!row.ready"
              :checked="selected.includes(row.id)"
              @change="toggleCandidate(row.id, ($event.target as HTMLInputElement).checked)"
            />
            <div>
              <div class="candidate-no">{{ row.orderNo }}</div>
              <div class="candidate-info">
                {{ row.receiverName }} · {{ row.itemCount }} 种商品 ·
                {{ row.productionUnitCount }} 件 · 已确认约{{ row.estimatedPrintPages }}页<span
                  v-if="row.unconfiguredPrintUnitCount"
                >
                  · {{ row.unconfiguredPrintUnitCount }}件打印方式待确认</span
                >
              </div>
              <div v-if="row.includesUnmatchedItems" class="mixed-note">
                筛选命中 {{ row.matchedUnitCount }} 件；另有
                {{ row.extraUnitCount }} 件会随整张订单一并加入
              </div>
            </div>
            <span class="badge" :class="row.ready ? 'badge-complete' : 'badge-error'">{{
              row.ready ? '可选择' : '暂不可生产'
            }}</span>
            <div>
              <div
                v-for="issue in row.hardBlocks"
                :key="issue.code + issue.message"
                class="issue error"
              >
                阻止：{{ issue.message }}
              </div>
              <div
                v-for="issue in row.warnings"
                :key="issue.code + issue.message"
                class="issue warning"
              >
                提醒：{{ issue.message }}
              </div>
              <div v-if="!row.hardBlocks.length && !row.warnings.length" class="issue success">
                资料完整，可以进入批次
              </div>
            </div></label
          >
        </div>
        <div class="modal-foot">
          <div>
            已选择 {{ selected.length }} 个总订单 · {{ selectedUnits }} 件 · 已确认约
            {{ selectedPages }} 页<span v-if="selectedUnknown">
              · {{ selectedUnknown }}件待确认</span
            >
          </div>
          <button
            class="btn btn-black"
            type="button"
            :disabled="!selected.length || creating"
            @click="submitBatch(false)"
          >
            {{ creating ? '正在创建...' : '确认创建' }}
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
