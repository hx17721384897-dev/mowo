<script setup lang="ts">
/* eslint-disable vue/html-closing-bracket-newline, vue/html-indent */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AdminSidebar from '@/components/AdminSidebar.vue'
import { runtimeConfig } from '@/config/runtime'
import { ApiError } from '@/services/api-client'
import {
  bindBatchTracking,
  createFrameReprint,
  downloadSignedFile,
  exportBatchAddresses,
  exportBatchProduction,
  fulfillmentLabels,
  listAdminOrders,
  orderStages,
  type AdminOrder,
  type FulfillmentStatus,
  type OrderStage,
  type ProductionUnit,
  type TrackingEntry
} from '@/features/admin-orders/api'
import './admin-orders.css'

const route = useRoute()
const router = useRouter()
const mobileOpen = ref(false)
const collapsed = ref(false)
const loading = ref(true)
const error = ref('')
const notice = ref('')
const orders = ref<AdminOrder[]>([])
const counts = ref<Partial<Record<FulfillmentStatus, number>>>({})
const keyword = ref('')
const busyAction = ref('')
const trackingDrafts = reactive<Record<string, { trackingNo: string; trackingCompany: string }>>({})
const reprintUnit = ref<ProductionUnit | null>(null)
const reprintPages = ref<number[]>([])
const reprintReason = ref('')
const reprintRequestId = ref('')
let requestSequence = 0
let noticeTimer: number | undefined

function normalizedStage(value: unknown): OrderStage {
  return typeof value === 'string' && value in orderStages ? (value as OrderStage) : 'all'
}

const stage = computed(() => normalizedStage(route.query.view))
const stageInfo = computed(() => orderStages[stage.value])
const stageKeys = Object.keys(orderStages) as OrderStage[]
const groupedOrders = computed(() => {
  const groups = new Map<string, AdminOrder[]>()
  for (const order of orders.value) {
    const key = order.batchId ?? 'NO_BATCH'
    const rows = groups.get(key) ?? []
    rows.push(order)
    groups.set(key, rows)
  }
  return [...groups.entries()]
})

function legacyUrl(file: string): string {
  return `${runtimeConfig.legacyWebBase}/${file}`
}

function stageNotice(value: OrderStage): string {
  if (value === 'paid')
    return '这里不直接创建另一套排产记录。点击“前往创建批次”，使用唯一的正式生产批次功能。'
  if (value === 'all')
    return '此页面只展示正式总订单 SO、生产批次 PB、单件产品 PU 和帧素材包 FP，不再读取旧定制订单状态。'
  return '每次操作都会推动正式总订单进入下一环节，并保留操作记录。'
}

function formatTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false })
}

function stageCount(key: OrderStage): number {
  if (key === 'all')
    return Object.values(counts.value).reduce((sum, value) => sum + (value ?? 0), 0)
  const status = orderStages[key].status
  return status ? (counts.value[status] ?? 0) : 0
}

function flash(message: string): void {
  notice.value = message
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => {
    notice.value = ''
  }, 3200)
}

function detailedError(cause: unknown): string {
  if (!(cause instanceof ApiError) || !Array.isArray(cause.details) || !cause.details.length)
    return cause instanceof Error ? cause.message : '操作失败'
  const rows = cause.details
    .map((value) => {
      if (!value || typeof value !== 'object') return ''
      const row = value as Record<string, unknown>
      const number = String(row.productionNo ?? row.orderNo ?? '—')
      const specification = String(row.specification ?? '')
      const reason = String(row.reason ?? '未知')
      return `${number}${specification ? ` · ${specification}` : ''}\n原因：${reason}`
    })
    .filter(Boolean)
  return rows.length ? `${cause.message}\n\n${rows.join('\n\n')}` : cause.message
}

async function loadOrders(): Promise<void> {
  const sequence = ++requestSequence
  loading.value = true
  error.value = ''
  try {
    const result = await listAdminOrders(stage.value, keyword.value)
    if (sequence !== requestSequence) return
    orders.value = result.orders
    counts.value = result.counts
    for (const order of result.orders) {
      trackingDrafts[order.id] = {
        trackingNo: order.trackingNo ?? '',
        trackingCompany: order.trackingCompany ?? ''
      }
    }
  } catch (cause) {
    if (sequence === requestSequence)
      error.value = cause instanceof Error ? cause.message : '正式订单加载失败'
  } finally {
    if (sequence === requestSequence) loading.value = false
  }
}

function applySearch(): void {
  void loadOrders()
}

function changeStage(value: OrderStage): void {
  void router.push({ name: 'admin-orders', query: value === 'all' ? {} : { view: value } })
}

function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function runBatchFileAction(
  key: string,
  confirmation: string,
  action: () => Promise<Blob>,
  fileName: string
): Promise<void> {
  if (busyAction.value || !window.confirm(confirmation)) return
  busyAction.value = key
  try {
    saveBlob(await action(), fileName)
    await loadOrders()
  } catch (cause) {
    window.alert(detailedError(cause))
  } finally {
    busyAction.value = ''
  }
}

function exportAddresses(batchId: string): void {
  void runBatchFileAction(
    `address:${batchId}`,
    `导出 ${batchId} 的收件地址，并让订单进入处理中？`,
    () => exportBatchAddresses(batchId),
    `${batchId}_收件地址.csv`
  )
}

async function submitTracking(batchId: string, batchOrders: AdminOrder[]): Promise<void> {
  if (busyAction.value) return
  const entries: TrackingEntry[] = batchOrders
    .map((order) => ({
      orderNo: order.orderNo,
      trackingNo: trackingDrafts[order.id]?.trackingNo.trim() ?? '',
      trackingCompany: trackingDrafts[order.id]?.trackingCompany.trim() ?? ''
    }))
    .filter((entry) => entry.trackingNo || entry.trackingCompany)
  if (!entries.length) return flash('请至少填写一张面单')
  if (entries.some((entry) => !entry.trackingNo || !entry.trackingCompany))
    return flash('每张面单必须同时填写快递单号和快递公司')
  busyAction.value = `tracking:${batchId}`
  try {
    await bindBatchTracking(batchId, entries)
    flash(`已绑定 ${entries.length} 个面单，订单进入待生产`)
    await loadOrders()
  } catch (cause) {
    flash(detailedError(cause))
  } finally {
    busyAction.value = ''
  }
}

function exportProduction(batchId: string): void {
  void runBatchFileAction(
    `production:${batchId}`,
    `导出 ${batchId} 的 Word、帧包标签和材料清单，并让打印线与材料线开始生产？`,
    () => exportBatchProduction(batchId),
    `${batchId}_生产资料.zip`
  )
}

function activePack(unit: ProductionUnit) {
  return unit.framePacks.find((pack) => pack.isActive) ?? null
}

function canReprint(unit: ProductionUnit): boolean {
  const pack = activePack(unit)
  return (
    stage.value === 'producing' &&
    !!pack &&
    ['CREATED', 'IN_PROGRESS'].includes(pack.status) &&
    (unit.printPageCount ?? 0) > 0
  )
}

function openReprint(unit: ProductionUnit): void {
  reprintUnit.value = unit
  reprintPages.value = []
  reprintReason.value = ''
  reprintRequestId.value = crypto.randomUUID()
  document.body.style.overflow = 'hidden'
}

function refreshReprintRequestId(): void {
  reprintRequestId.value = crypto.randomUUID()
}

function closeReprint(force = false): void {
  if (!force && busyAction.value === 'reprint') return
  reprintUnit.value = null
  reprintPages.value = []
  reprintReason.value = ''
  reprintRequestId.value = ''
  document.body.style.overflow = ''
}

async function submitReprint(): Promise<void> {
  const unit = reprintUnit.value
  if (!unit || busyAction.value) return
  const pages = [...new Set(reprintPages.value)].sort((a, b) => a - b)
  const reason = reprintReason.value.trim()
  if (!pages.length) return flash('请选择需要重印的页')
  if (!reason) return flash('请填写返工原因')
  if (
    !window.confirm(`将作废当前帧包码，生成新的 FP 码，并只打印第 ${pages.join('、')} 页。继续吗？`)
  )
    return
  busyAction.value = 'reprint'
  try {
    const result = await createFrameReprint(
      unit.id,
      pages,
      reason,
      reprintRequestId.value || crypto.randomUUID()
    )
    saveBlob(await downloadSignedFile(result.downloadUrl), result.fileName)
    flash(result.message)
    closeReprint(true)
    await loadOrders()
  } catch (cause) {
    flash(detailedError(cause))
  } finally {
    busyAction.value = ''
    if (!reprintUnit.value) document.body.style.overflow = ''
  }
}

watch(
  () => route.query.view,
  () => {
    keyword.value = ''
    void loadOrders()
  }
)
onMounted(() => void loadOrders())
onBeforeUnmount(() => {
  requestSequence++
  window.clearTimeout(noticeTimer)
  document.body.style.overflow = ''
})
</script>

<template>
  <div class="admin-orders-page">
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
          <div class="title">订单生产</div>
        </div>
        <div class="top-actions">
          <RouterLink class="btn" to="/admin/production-batches">生产批次总览</RouterLink>
          <button class="btn" type="button" :disabled="loading" @click="loadOrders">刷新</button>
        </div>
      </header>
      <div class="content">
        <section class="stats" aria-label="订单环节统计">
          <button
            v-for="key in stageKeys"
            :key="key"
            class="stat"
            :class="{ active: key === stage }"
            type="button"
            @click="changeStage(key)"
          >
            <span class="stat-label">{{ orderStages[key].label }}</span>
            <strong class="stat-value">{{ stageCount(key) }}</strong>
          </button>
        </section>

        <div class="page-head">
          <div>
            <div class="page-title-wrap">
              <h1 class="page-title">{{ stageInfo.label }}</h1>
              <button class="stage-help" type="button" aria-label="查看当前环节说明">
                ?
                <span class="stage-help-card" role="tooltip">
                  <strong class="stage-help-title">{{ stageInfo.label }}</strong>
                  <span class="stage-help-text">{{ stageInfo.description }}</span>
                  <span class="stage-help-text">{{ stageNotice(stage) }}</span>
                </span>
              </button>
            </div>
          </div>
          <input
            v-model="keyword"
            class="search"
            aria-label="搜索正式订单"
            placeholder="搜索订单、收件人、手机号或面单"
            @keydown.enter="applySearch"
          />
        </div>

        <div v-if="notice" class="toast show" role="status">{{ notice }}</div>
        <div v-if="loading" class="empty">正在读取正式订单...</div>
        <div v-else-if="error" class="empty error-state">
          <p>{{ error }}</p>
          <button class="btn" type="button" @click="loadOrders">重新加载</button>
        </div>
        <div v-else-if="!orders.length" class="empty">当前环节没有订单</div>
        <div v-else class="order-groups">
          <section v-for="[batchId, batchOrders] in groupedOrders" :key="batchId" class="batch">
            <div class="batch-head">
              <div>
                <div class="batch-no">
                  {{ batchId === 'NO_BATCH' ? '尚未进入生产批次' : batchId }}
                </div>
                <div class="batch-meta">
                  {{ batchOrders.length }} 个总订单 ·
                  {{ batchOrders.reduce((sum, order) => sum + order.itemCount, 0) }} 件商品
                </div>
              </div>
              <div class="actions">
                <RouterLink
                  v-if="batchId === 'NO_BATCH'"
                  class="btn btn-black"
                  to="/admin/production-batches"
                >
                  前往创建批次
                </RouterLink>
                <button
                  v-else-if="stage === 'pending'"
                  class="btn btn-black"
                  type="button"
                  :disabled="!!busyAction"
                  @click="exportAddresses(batchId)"
                >
                  导出本批次地址
                </button>
                <button
                  v-else-if="stage === 'locked'"
                  class="btn btn-black"
                  type="button"
                  :disabled="!!busyAction"
                  @click="submitTracking(batchId, batchOrders)"
                >
                  确认本批次面单
                </button>
                <button
                  v-else-if="stage === 'processing'"
                  class="btn btn-black"
                  type="button"
                  :disabled="!!busyAction"
                  @click="exportProduction(batchId)"
                >
                  导出生产资料并开工
                </button>
                <a
                  v-else-if="stage === 'producing'"
                  class="btn btn-black"
                  :href="legacyUrl('production-scan.html?v=20260904-1#overview')"
                  >进入扫码作业</a
                >
                <a
                  v-else-if="stage === 'ready'"
                  class="btn btn-black"
                  :href="legacyUrl('production-scan.html?v=20260904-1#packing')"
                  >进入装箱发货</a
                >
                <RouterLink
                  v-else
                  class="btn"
                  :to="{ path: '/admin/production-batches', query: { batchId } }"
                >
                  查看批次
                </RouterLink>
              </div>
            </div>

            <article v-for="order in batchOrders" :key="order.id" class="order">
              <div class="order-head">
                <div>
                  <div class="order-no">{{ order.orderNo }}</div>
                  <div class="order-sub">
                    {{ order.itemCount }} 件 · 支付 {{ formatTime(order.paidAt) }}
                  </div>
                </div>
                <div class="address">
                  {{ order.receiverName || '未填写' }} · {{ order.receiverPhone || '' }}<br />
                  {{ order.receiverCity || '' }} {{ order.receiverAddress || '' }}
                  <template v-if="order.trackingNo">
                    <br />{{ order.trackingCompany }} {{ order.trackingNo }}
                  </template>
                </div>
                <span class="badge">{{ fulfillmentLabels[order.fulfillmentStatus] }}</span>
              </div>

              <div v-if="stage === 'locked'" class="tracking-grid">
                <input
                  v-model="trackingDrafts[order.id]!.trackingNo"
                  :aria-label="`${order.orderNo} 快递单号`"
                  placeholder="快递单号"
                />
                <input
                  v-model="trackingDrafts[order.id]!.trackingCompany"
                  :aria-label="`${order.orderNo} 快递公司`"
                  placeholder="快递公司"
                />
              </div>

              <div class="units">
                <div v-for="unit in order.units" :key="unit.id" class="unit">
                  <div>
                    <div class="unit-no">{{ unit.productionNo }} · {{ unit.title }}</div>
                    <div class="unit-spec">{{ unit.specification }}</div>
                  </div>
                  <div class="unit-state">
                    <template v-if="unit.workflow">
                      帧包 {{ unit.workflow.frameStatus || '—' }} · 领料
                      {{ unit.workflow.materialStatus || '—' }} · 配对
                      {{ unit.workflow.pairingStatus || '—' }} · 装箱
                      {{ unit.workflow.packageStatus || '—' }}
                    </template>
                    <template v-else>尚未进入批次</template>
                    <template v-for="pack in unit.framePacks" :key="pack.code">
                      <br />
                      <span
                        :class="pack.isActive ? 'fp-active' : 'fp-void'"
                        :title="pack.voidReason || undefined"
                      >
                        {{ pack.isActive ? `当前 ${pack.code}` : pack.code }}
                      </span>
                    </template>
                    <template v-if="unit.reprintCount">
                      <br />返工 {{ unit.reprintCount }} 次
                    </template>
                  </div>
                  <div class="actions">
                    <button
                      v-if="canReprint(unit)"
                      class="btn btn-sm btn-yellow"
                      type="button"
                      :disabled="!!busyAction"
                      @click="openReprint(unit)"
                    >
                      重印
                    </button>
                  </div>
                </div>
              </div>
            </article>
          </section>
        </div>
      </div>
    </main>

    <div v-if="reprintUnit" class="overlay show" role="presentation" @click.self="closeReprint()">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="reprint-title">
        <h2 id="reprint-title">重印帧素材包</h2>
        <p>
          {{ reprintUnit.productionNo }} · 共
          {{ reprintUnit.printPageCount }} 页。只勾选实际损坏的页；系统仍会生成新的 FP 码。
        </p>
        <div class="page-options">
          <label v-for="page in reprintUnit.printPageCount || 0" :key="page" class="page-option">
            <input
              v-model="reprintPages"
              type="checkbox"
              :value="page"
              @change="refreshReprintRequestId"
            />
            第 {{ page }} 页
          </label>
        </div>
        <label class="field-label" for="reprint-reason">返工原因</label>
        <textarea
          id="reprint-reason"
          v-model="reprintReason"
          class="reason"
          maxlength="1000"
          placeholder="例如：裁切偏移，第 2 页需要重新打印"
          @input="refreshReprintRequestId"
        ></textarea>
        <div class="modal-foot">
          <button
            class="btn"
            type="button"
            :disabled="busyAction === 'reprint'"
            @click="closeReprint()"
          >
            取消
          </button>
          <button
            class="btn btn-black"
            type="button"
            :disabled="busyAction === 'reprint'"
            @click="submitReprint"
          >
            {{ busyAction === 'reprint' ? '正在生成...' : '生成新帧包码并下载' }}
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
