<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import AdminSidebar from '@/components/AdminSidebar.vue'
import MaterialInventoryPanel from '@/features/admin-inventory/MaterialInventoryPanel.vue'
import ReturnInventoryPanel from '@/features/admin-inventory/ReturnInventoryPanel.vue'
import InventoryLogsPanel from '@/features/admin-inventory/InventoryLogsPanel.vue'
import ChannelQuotaPanel from '@/features/admin-inventory/ChannelQuotaPanel.vue'
import FramePackInventoryPanel from '@/features/admin-inventory/FramePackInventoryPanel.vue'
import { ApiError } from '@/services/api-client'
import {
  adjustInventory,
  loadChannelQuotas,
  loadInventory,
  loadInventoryDetail,
  saveInventorySettings,
  type AlertLevel,
  type ChannelQuota,
  type InventoryDetail,
  type InventoryRow
} from '@/features/admin-inventory/api'
import './admin-inventory.css'

const mobileOpen = ref(false),
  collapsed = ref(false),
  loading = ref(true),
  busy = ref(false),
  notice = ref(''),
  noticeError = ref(false)
const rows = ref<InventoryRow[]>([]),
  search = ref(''),
  alertFilter = ref<AlertLevel | ''>(''),
  page = ref(1)
const activeTab = ref(0)
const packedPanel = ref<InstanceType<typeof MaterialInventoryPanel> | null>(null)
const rawPanel = ref<InstanceType<typeof MaterialInventoryPanel> | null>(null)
const returnPanel = ref<InstanceType<typeof ReturnInventoryPanel> | null>(null)
const logsPanel = ref<InstanceType<typeof InventoryLogsPanel> | null>(null)
const quotaPanel = ref<InstanceType<typeof ChannelQuotaPanel> | null>(null)
const framePackPanel = ref<InstanceType<typeof FramePackInventoryPanel> | null>(null)
const detail = ref<InventoryDetail | null>(null),
  quota = ref<ChannelQuota | null>(null),
  drawerOpen = ref(false)
const adjustment = reactive({ quantity: 0, note: '' })
const settings = reactive({ safetyStock: 0, maxOrderLimit: 0, safetyFactor: 1 })
const pageSize = 10
const pendingKey = 'mowo.inventory.pendingAdjustment'
let noticeTimer: number | undefined

const filtered = computed(() => {
  const query = search.value.trim().toLowerCase()
  return rows.value.filter((row) => {
    if (alertFilter.value && row.alertLevel !== alertFilter.value) return false
    return (
      !query ||
      [
        row.modelName,
        row.skuName,
        row.skuCode,
        row.skuBarcode,
        row.size,
        row.material,
        row.frameCount,
        row.colorName
      ]
        .join(' ')
        .toLowerCase()
        .includes(query)
    )
  })
})
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)))
const visibleRows = computed(() =>
  filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize)
)
const stats = computed(() => ({
  total: rows.value.length,
  critical: rows.value.filter((row) => row.alertLevel === 'CRITICAL').length,
  warning: rows.value.filter((row) => row.alertLevel === 'WARNING').length,
  available: rows.value.reduce((sum, row) => sum + Math.max(available(row), 0), 0),
  locked: rows.value.reduce((sum, row) => sum + Number(row.reservedStock || 0), 0),
  wip: rows.value.reduce((sum, row) => sum + Number(row.wipFrameQty || 0), 0)
}))
const tabs = [
  { icon: '📦', label: '标准材料包' },
  { icon: '🧺', label: '已分装小包' },
  { icon: '🧩', label: '基础零件' },
  { icon: '↩', label: '退回检查' },
  { icon: '📋', label: '变动记录' },
  { icon: '📡', label: '渠道配额' },
  { icon: '🎞', label: '帧包库存' }
]
const alertOptions: { value: AlertLevel | ''; label: string }[] = [
  { value: '', label: '全部' },
  { value: 'CRITICAL', label: '🔴 紧急不足' },
  { value: 'WARNING', label: '🟡 库存偏低' },
  { value: 'SUGGEST', label: '🔵 建议补货' },
  { value: 'OK', label: '✅ 充足' }
]
const badgeText: Record<AlertLevel, string> = {
  OK: '✅ 充足',
  SUGGEST: '🔵 补货',
  WARNING: '🟡 偏低',
  CRITICAL: '🔴 紧急'
}

function available(row: InventoryRow) {
  return Number(row.availableQty ?? row.availableStock ?? 0)
}
function specification(row: InventoryRow) {
  return [row.size, row.material, row.frameCount ? `${row.frameCount}帧` : '', row.colorName]
    .filter(Boolean)
    .join(' · ')
}
function flash(message: string, error = false) {
  notice.value = message
  noticeError.value = error
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => (notice.value = ''), 2800)
}
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作失败'
}
async function refresh() {
  loading.value = true
  try {
    rows.value = await loadInventory()
    await Promise.all([
      packedPanel.value?.refresh(),
      rawPanel.value?.refresh(),
      returnPanel.value?.refresh(),
      logsPanel.value?.refresh(),
      quotaPanel.value?.refresh(),
      framePackPanel.value?.refresh()
    ])
    if (page.value > pageCount.value) page.value = pageCount.value
  } catch (error) {
    flash(errorMessage(error), true)
  } finally {
    loading.value = false
  }
}
function setFilter(value: AlertLevel | '') {
  alertFilter.value = value
  page.value = 1
}
async function openDrawer(row: InventoryRow) {
  drawerOpen.value = true
  detail.value = null
  quota.value = null
  adjustment.quantity = 0
  adjustment.note = ''
  try {
    const [inventory, quotas] = await Promise.all([
      loadInventoryDetail(row.skuId),
      loadChannelQuotas()
    ])
    detail.value = inventory
    quota.value = quotas.find((item) => item.skuId === row.skuId) || null
    settings.safetyStock = Number(inventory.safetyStock || 0)
    settings.maxOrderLimit = Number(inventory.maxOrderLimit || 0)
    settings.safetyFactor = Number(inventory.safetyFactor || 1)
  } catch (error) {
    flash(errorMessage(error), true)
  }
}
function closeDrawer() {
  if (busy.value) return
  drawerOpen.value = false
  detail.value = null
}
function openKitAssembly(skuId: string) {
  packedPanel.value?.openAssembly(skuId)
}
function requestId(skuId: string, quantity: number, note: string) {
  const fingerprint = JSON.stringify({ skuId, quantity, note })
  try {
    const pending = JSON.parse(sessionStorage.getItem(pendingKey) || 'null') as {
      fingerprint?: string
      clientRequestId?: string
    } | null
    if (pending?.fingerprint === fingerprint && pending.clientRequestId)
      return pending.clientRequestId
  } catch {
    // Replace malformed local state below.
  }
  const clientRequestId = `inventory-${crypto.randomUUID()}`
  sessionStorage.setItem(pendingKey, JSON.stringify({ fingerprint, clientRequestId }))
  return clientRequestId
}
async function submitAdjustment() {
  if (!detail.value || !Number.isInteger(adjustment.quantity) || adjustment.quantity === 0)
    return flash('请输入非零整数；调减库存请填写负数', true)
  const skuId = detail.value.skuId
  const note = adjustment.note.trim()
  const clientRequestId = requestId(skuId, adjustment.quantity, note)
  busy.value = true
  try {
    const result = await adjustInventory(skuId, {
      quantity: adjustment.quantity,
      note: note || undefined,
      clientRequestId
    })
    sessionStorage.removeItem(pendingKey)
    flash(result.reused ? '库存调整已恢复，没有重复增减' : '库存调整已保存')
    await refresh()
    await openDrawer(result)
  } catch (error) {
    if (error instanceof ApiError && error.status > 0) sessionStorage.removeItem(pendingKey)
    flash(errorMessage(error), true)
  } finally {
    busy.value = false
  }
}
async function saveSettings() {
  if (!detail.value) return
  if (
    settings.safetyStock < 0 ||
    settings.maxOrderLimit < 0 ||
    settings.safetyFactor < 0.1 ||
    settings.safetyFactor > 5
  )
    return flash('请检查策略数值范围', true)
  busy.value = true
  try {
    await saveInventorySettings(detail.value.skuId, { ...settings })
    flash('设置已保存')
    await refresh()
    await openDrawer(detail.value)
  } catch (error) {
    flash(errorMessage(error), true)
  } finally {
    busy.value = false
  }
}
function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

onMounted(() => void refresh())
onBeforeUnmount(() => window.clearTimeout(noticeTimer))
</script>

<template>
  <div class="admin-inventory-page">
    <AdminSidebar
      :mobile-open="mobileOpen"
      @mobile-close="mobileOpen = false"
      @collapse-change="collapsed = $event"
    />
    <main class="main" :class="{ expanded: collapsed }">
      <header class="topbar">
        <div class="top-actions">
          <button class="btn menu-btn" type="button" @click="mobileOpen = true">☰</button>
          <h1>库存管理</h1>
        </div>
        <button class="btn" type="button" :disabled="loading" @click="refresh">↻ 刷新</button>
      </header>
      <div class="content">
        <div class="stats-grid">
          <div class="stat-card">
            <i class="stat-dot green"></i>
            <span>SKU 总数</span><strong>{{ stats.total }}</strong>
          </div>
          <div class="stat-card critical">
            <i class="stat-dot orange"></i>
            <span>紧急不足</span><strong>{{ stats.critical }}</strong>
          </div>
          <div class="stat-card warning">
            <i class="stat-dot yellow"></i>
            <span>库存偏低</span><strong>{{ stats.warning }}</strong>
          </div>
          <div class="stat-card">
            <i class="stat-dot green"></i>
            <span>总可用库存</span><strong>{{ stats.available }}</strong>
          </div>
          <div class="stat-card locked">
            <i class="stat-dot blue-dot"></i>
            <span>总锁定量</span><strong>{{ stats.locked }}</strong
            ><small>待支付 + 待生产</small>
          </div>
          <div class="stat-card">
            <span>总在制量</span><strong>{{ stats.wip }}</strong
            ><small>帧图在制中</small>
          </div>
        </div>
        <div class="import-banner">
          <span
            >📥 有来自
            <b>淘宝 / 抖音 / 小红书</b>
            的订单需要录入？前往「订单导入」，系统将自动标记渠道来源并锁定对应库存配额。</span
          >
          <RouterLink class="btn" to="/admin/import">前往订单导入 →</RouterLink>
        </div>
        <div class="main-tabs" aria-label="库存领域候选进度">
          <button
            v-for="(tab, index) in tabs"
            :key="tab.label"
            class="main-tab"
            :class="{ active: index === activeTab }"
            type="button"
            @click="activeTab = index"
          >
            <span aria-hidden="true">{{ tab.icon }}</span> {{ tab.label }}
          </button>
        </div>
        <section v-if="activeTab === 0" class="stock-panel">
          <div class="toolbar">
            <div class="filter-tabs">
              <button
                v-for="option in alertOptions"
                :key="option.value"
                class="filter-tab"
                :class="{ active: alertFilter === option.value }"
                type="button"
                @click="setFilter(option.value)"
              >
                {{ option.label }}
              </button>
            </div>
            <input
              v-model="search"
              class="search-input"
              placeholder="搜索款式或规格…"
              @input="page = 1"
            />
          </div>
          <div class="table-wrap">
            <div class="table-header">
              <div></div>
              <div>款式</div>
              <div>规格</div>
              <div>材料包库存</div>
              <div>锁定</div>
              <div>在制量</div>
              <div>可用</div>
              <div>安全线 / 预警</div>
              <div>操作</div>
            </div>
            <div v-if="loading" class="empty">正在加载…</div>
            <div v-else-if="!visibleRows.length" class="empty">📦 没有符合条件的记录</div>
            <div
              v-for="row in visibleRows"
              v-else
              :key="row.skuId"
              class="inv-row"
              role="button"
              tabindex="0"
              @click="openDrawer(row)"
              @keydown.enter.self="openDrawer(row)"
            >
              <span class="alert-dot" :class="row.alertLevel.toLowerCase()"></span>
              <strong>{{ row.modelName }}</strong>
              <span class="spec"
                ><i v-if="row.colorHex" :style="{ background: row.colorHex }"></i
                >{{ specification(row) || row.skuName
                }}<small>{{ row.skuCode || row.skuBarcode }}</small></span
              >
              <b>{{ row.currentStock || 0 }}</b
              ><b class="blue">{{ row.reservedStock || 0 }}</b
              ><b class="blue">{{ row.wipFrameQty || 0 }}</b>
              <strong class="available" :class="row.alertLevel.toLowerCase()">{{
                Math.max(available(row), 0)
              }}</strong>
              <span
                >安全 <b>{{ row.safetyStock || 0 }}</b
                ><small class="badge" :class="row.alertLevel.toLowerCase()">{{
                  badgeText[row.alertLevel]
                }}</small></span
              >
              <span class="row-actions"
                ><button
                  class="btn btn-green btn-xs"
                  type="button"
                  @click.stop="openKitAssembly(row.skuId)"
                >
                  材料包入库</button
                ><button class="btn btn-sm" type="button" @click.stop="openDrawer(row)">
                  详情
                </button></span
              >
            </div>
          </div>
          <div v-if="pageCount > 1" class="pagination">
            <span>共 {{ filtered.length }} 条 / 第 {{ page }} 页</span
            ><button
              v-for="number in pageCount"
              :key="number"
              type="button"
              :class="{ active: page === number }"
              @click="page = number"
            >
              {{ number }}
            </button>
          </div>
        </section>
        <MaterialInventoryPanel
          ref="packedPanel"
          mode="PACKED"
          :visible="activeTab === 1"
          :inventory="rows"
          @flash="flash"
          @inventory-changed="refresh"
        />
        <ReturnInventoryPanel
          v-show="activeTab === 3"
          ref="returnPanel"
          @flash="flash"
          @inventory-changed="refresh"
        />
        <InventoryLogsPanel v-show="activeTab === 4" ref="logsPanel" @flash="flash" />
        <ChannelQuotaPanel v-show="activeTab === 5" ref="quotaPanel" @flash="flash" />
        <FramePackInventoryPanel v-show="activeTab === 6" ref="framePackPanel" @flash="flash" />
        <MaterialInventoryPanel
          ref="rawPanel"
          mode="RAW"
          :visible="activeTab === 2"
          :inventory="rows"
          @flash="flash"
          @inventory-changed="refresh"
        />
      </div>
    </main>
    <div class="drawer-overlay" :class="{ show: drawerOpen }" @click="closeDrawer"></div>
    <aside class="drawer" :class="{ open: drawerOpen }" aria-label="库存详情">
      <header>
        <div>
          <h2>{{ detail?.modelName || '库存详情' }}</h2>
          <p>{{ detail ? specification(detail) : '正在加载…' }}</p>
        </div>
        <button type="button" :disabled="busy" @click="closeDrawer">×</button>
      </header>
      <div v-if="!detail" class="empty">正在读取库存详情…</div>
      <template v-else>
        <section>
          <h3>库存概况（四态）</h3>
          <div class="state-grid">
            <div>
              <b>{{ detail.currentStock }}</b
              ><span>总库存</span>
            </div>
            <div>
              <b>{{ available(detail) }}</b
              ><span>可用</span>
            </div>
            <div>
              <b>{{ detail.reservedStock }}</b
              ><span>锁定</span>
            </div>
            <div>
              <b>{{ detail.wipFrameQty }}</b
              ><span>帧图在制</span>
            </div>
          </div>
        </section>
        <section>
          <h3>渠道配额</h3>
          <p v-if="quota">
            淘宝 {{ quota.taobaoQty }} + 抖音 {{ quota.douyinQty }} + 小红书 {{ quota.xhsQty }} /
            可分配 {{ quota.allocatable }}
          </p>
          <p v-else>未配置渠道配额</p>
        </section>
        <section>
          <h3>手工入库 / 盘点调减</h3>
          <p class="hint">正数增加库存，负数调减库存；网络失败后再次提交不会重复增减。</p>
          <div class="adjust-row">
            <input
              v-model.number="adjustment.quantity"
              type="number"
              step="1"
              placeholder="如 50 或 -5"
            /><input
              v-model="adjustment.note"
              maxlength="200"
              placeholder="备注（调减时建议填写原因）"
            /><button
              class="btn btn-black"
              type="button"
              :disabled="busy"
              @click="submitAdjustment"
            >
              确认
            </button>
          </div>
        </section>
        <section>
          <h3>策略设置</h3>
          <div class="settings-grid">
            <label
              >安全库存线<input
                v-model.number="settings.safetyStock"
                type="number"
                min="0" /></label
            ><label
              >最大下单上限<input
                v-model.number="settings.maxOrderLimit"
                type="number"
                min="0" /></label
            ><label
              >流量因子<input
                v-model.number="settings.safetyFactor"
                type="number"
                min="0.1"
                max="5"
                step="0.1"
            /></label>
          </div>
          <button class="btn" type="button" :disabled="busy" @click="saveSettings">保存策略</button>
        </section>
        <section>
          <h3>变动记录（最近 100 条）</h3>
          <div v-if="!detail.logs.length" class="empty">暂无记录</div>
          <div v-for="log in detail.logs" v-else :key="log.id" class="log-row">
            <span>{{ formatTime(log.createdAt) }}</span
            ><b>{{ log.type }}</b
            ><strong>{{ log.quantity }}</strong
            ><span>{{ log.reason || log.note || '—' }}</span>
          </div>
        </section>
      </template>
    </aside>
    <div v-if="notice" class="toast" :class="{ error: noticeError }">{{ notice }}</div>
  </div>
</template>
