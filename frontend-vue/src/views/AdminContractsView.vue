<script setup lang="ts">
/* eslint-disable vue/html-closing-bracket-newline, vue/html-indent, vue/multiline-html-element-content-newline */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AdminSidebar from '@/components/AdminSidebar.vue'
import {
  addContractPayment,
  getContract,
  listContracts,
  saveContract,
  setContractStatus,
  type ContractInput,
  type ContractStatus,
  type ContractType,
  type ManagedContract
} from '@/features/admin-contracts/api'
import './admin-collab-review.css'
import './admin-contracts.css'

const mobileOpen = ref(false)
const collapsed = ref(false)
const search = ref('')
const status = ref<ContractStatus | ''>('')
const type = ref<ContractType | ''>('')
const page = ref(1)
const total = ref(0)
const totalPages = ref(0)
const contracts = ref<ManagedContract[]>([])
const loading = ref(true)
const error = ref('')
const drawer = ref<'new' | 'edit' | 'payment' | null>(null)
const selected = ref<ManagedContract | null>(null)
const detailLoading = ref(false)
const detailError = ref('')
const busy = ref(false)
const notice = ref('')
const paymentKey = ref('')
const paymentAmount = ref('')
const paymentNote = ref('')
const paymentDate = ref('')
const form = ref({
  creatorName: '',
  contractType: 'revenue_share' as ContractType,
  revenueRate: '',
  guaranteeAmount: '',
  buyoutAmount: '',
  startAt: '',
  endAt: '',
  terms: '',
  note: ''
})
const types: Array<{ value: ContractType; label: string }> = [
  { value: 'revenue_share', label: '纯分红' },
  { value: 'guarantee_plus', label: '保底+分红' },
  { value: 'buyout', label: '买断' },
  { value: 'custom', label: '自定义' }
]
const statuses: Array<{ value: ContractStatus; label: string }> = [
  { value: 'active', label: '生效中' },
  { value: 'expired', label: '已到期' },
  { value: 'terminated', label: '已终止' }
]
let listSequence = 0
let detailSequence = 0
let searchTimer: number | undefined
let noticeTimer: number | undefined
const paginationButtons = computed(() =>
  Array.from({ length: totalPages.value }, (_, index) => index + 1).filter(
    (number) => number === 1 || number === totalPages.value || Math.abs(number - page.value) <= 1
  )
)
function typeLabel(value: string): string {
  return types.find((item) => item.value === value)?.label || value
}
function statusLabel(value: string): string {
  return statuses.find((item) => item.value === value)?.label || value
}
function money(value: number | null | undefined): string {
  return Number(value || 0).toLocaleString('zh-CN')
}
function date(value?: string | null): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? '—'
    : parsed.toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' })
}
function inputDate(value?: string | null): string {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`
}
function flash(message: string): void {
  notice.value = message
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => {
    notice.value = ''
  }, 2800)
}
async function load(nextPage = page.value): Promise<void> {
  const sequence = ++listSequence
  page.value = nextPage
  loading.value = true
  error.value = ''
  try {
    const result = await listContracts(nextPage, status.value, type.value, search.value.trim())
    if (sequence !== listSequence) return
    contracts.value = result.contracts
    total.value = result.pagination.total
    totalPages.value = result.pagination.totalPages
  } catch (cause) {
    if (sequence === listSequence) error.value = cause instanceof Error ? cause.message : '加载失败'
  } finally {
    if (sequence === listSequence) loading.value = false
  }
}
function filterChanged(): void {
  void load(1)
}
watch(search, () => {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(filterChanged, 400)
})
watch(drawer, (value) => {
  document.body.style.overflow = value ? 'hidden' : ''
})
function resetForm(contract: ManagedContract | null): void {
  form.value = {
    creatorName: contract?.creatorName || '',
    contractType: contract?.contractType || 'revenue_share',
    revenueRate: contract?.revenueRate != null ? String(contract.revenueRate * 100) : '',
    guaranteeAmount: contract?.guaranteeAmount != null ? String(contract.guaranteeAmount) : '',
    buyoutAmount: contract?.buyoutAmount != null ? String(contract.buyoutAmount) : '',
    startAt: inputDate(contract?.startAt),
    endAt: inputDate(contract?.endAt),
    terms: contract?.terms || '',
    note: contract?.note || ''
  }
}
function openNew(): void {
  selected.value = null
  detailError.value = ''
  resetForm(null)
  drawer.value = 'new'
}
async function openEdit(contract: ManagedContract): Promise<void> {
  const sequence = ++detailSequence
  selected.value = contract
  drawer.value = 'edit'
  detailLoading.value = true
  detailError.value = ''
  try {
    const result = await getContract(contract.id)
    if (sequence === detailSequence) {
      selected.value = result
      resetForm(result)
    }
  } catch (cause) {
    if (sequence === detailSequence)
      detailError.value = cause instanceof Error ? cause.message : '加载失败'
  } finally {
    if (sequence === detailSequence) detailLoading.value = false
  }
}
function openPayment(contract: ManagedContract): void {
  selected.value = contract
  paymentAmount.value = ''
  paymentNote.value = ''
  paymentDate.value = new Date().toISOString().slice(0, 10)
  paymentKey.value = crypto.randomUUID()
  drawer.value = 'payment'
}
function closeDrawer(): void {
  ++detailSequence
  drawer.value = null
  selected.value = null
}
function numericOptional(value: string, label: string): number | undefined {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label}必须是非负数字`)
  return parsed
}
function formPayload(): ContractInput {
  const name = form.value.creatorName.trim()
  if (!name) throw new Error('请填写合作方名称')
  if (!form.value.startAt) throw new Error('请选择合同开始日期')
  if (form.value.endAt && form.value.endAt < form.value.startAt)
    throw new Error('合同结束日期不能早于开始日期')
  const rate = numericOptional(form.value.revenueRate, '分红比例')
  if (rate != null && rate > 100) throw new Error('分红比例不能超过 100%')
  const guarantee = numericOptional(form.value.guaranteeAmount, '保底金额')
  const buyout = numericOptional(form.value.buyoutAmount, '买断金额')
  return {
    creatorName: name,
    contractType: form.value.contractType,
    startAt: form.value.startAt,
    endAt: form.value.endAt || '',
    terms: form.value.terms.trim(),
    note: form.value.note.trim(),
    ...(rate != null ? { revenueRate: rate / 100 } : {}),
    ...(guarantee != null ? { guaranteeAmount: guarantee } : {}),
    ...(buyout != null ? { buyoutAmount: buyout } : {})
  }
}
async function submitForm(): Promise<void> {
  if (busy.value || detailLoading.value) return
  let payload: ContractInput
  try {
    payload = formPayload()
  } catch (cause) {
    flash(cause instanceof Error ? cause.message : '表单无效')
    return
  }
  busy.value = true
  try {
    await saveContract(selected.value?.id || null, payload)
    flash(selected.value ? '✅ 已更新' : '✅ 合同已创建')
    closeDrawer()
    await load()
  } catch (cause) {
    flash(`操作失败：${cause instanceof Error ? cause.message : '网络错误'}`)
  } finally {
    busy.value = false
  }
}
async function submitPayment(): Promise<void> {
  if (busy.value || !selected.value) return
  const amount = Number(paymentAmount.value)
  if (!Number.isFinite(amount) || amount <= 0) {
    flash('请填写打款金额')
    return
  }
  busy.value = true
  try {
    const result = await addContractPayment(
      selected.value.id,
      amount,
      paymentNote.value.trim(),
      paymentDate.value,
      paymentKey.value
    )
    flash(`✅ 打款记录已录入，累计 ¥${money(result.totalPaid)}`)
    closeDrawer()
    await load()
  } catch (cause) {
    flash(`操作失败：${cause instanceof Error ? cause.message : '网络错误'}`)
  } finally {
    busy.value = false
  }
}
async function terminate(contract: ManagedContract): Promise<void> {
  if (busy.value || !window.confirm('确认将合同状态改为「已终止」？')) return
  busy.value = true
  try {
    await setContractStatus(contract.id, 'terminated')
    flash('✅ 状态已更新为「已终止」')
    await load()
  } catch (cause) {
    flash(`操作失败：${cause instanceof Error ? cause.message : '网络错误'}`)
  } finally {
    busy.value = false
  }
}
onMounted(() => {
  void load(1)
})
onBeforeUnmount(() => {
  window.clearTimeout(searchTimer)
  window.clearTimeout(noticeTimer)
  document.body.style.overflow = ''
})
</script>

<template>
  <div class="admin-collab-review-page admin-contracts-page">
    <AdminSidebar v-model:collapsed="collapsed" v-model:mobile-open="mobileOpen" />
    <main class="review-main" :class="{ expanded: collapsed }">
      <header class="review-topbar">
        <button class="review-menu" type="button" aria-label="打开菜单" @click="mobileOpen = true">
          ☰</button
        ><span class="review-topbar-title">商务合同</span>
        <div class="review-topbar-right">
          <button class="review-btn yellow" type="button" @click="openNew">＋ 新建合同</button>
        </div>
      </header>
      <div class="review-content">
        <div class="contracts-toolbar">
          <input
            v-model="search"
            type="search"
            placeholder="搜索合作方名称…"
            aria-label="搜索合作方名称"
          /><select v-model="status" aria-label="合同状态" @change="filterChanged">
            <option value="">全部状态</option>
            <option v-for="item in statuses" :key="item.value" :value="item.value">
              {{ item.label }}
            </option></select
          ><select v-model="type" aria-label="合作类型" @change="filterChanged">
            <option value="">全部类型</option>
            <option v-for="item in types" :key="item.value" :value="item.value">
              {{ item.label }}
            </option>
          </select>
        </div>
        <div v-if="loading" class="review-loading">正在加载…</div>
        <div v-else-if="error" class="review-empty">
          加载失败：{{ error }}
          <button class="review-btn ghost small" type="button" @click="load()">重试</button>
        </div>
        <div v-else-if="!contracts.length" class="review-empty">
          <div class="review-empty-icon">📝</div>
          暂无合同记录
        </div>
        <article
          v-for="contract in loading || error ? [] : contracts"
          :key="contract.id"
          class="contracts-card"
        >
          <div class="contracts-header">
            <div>
              <div class="contracts-name">{{ contract.creatorName }}</div>
              <div class="contracts-id">{{ contract.id.slice(-8) }}</div>
            </div>
            <div class="contracts-badges">
              <span class="contracts-type" :class="contract.contractType">{{
                typeLabel(contract.contractType)
              }}</span
              ><span class="contracts-status" :class="contract.status">{{
                statusLabel(contract.status)
              }}</span>
            </div>
          </div>
          <div class="contracts-grid">
            <div>
              <span>合同期限</span
              ><strong
                >{{ date(contract.startAt) }} ~
                {{ contract.endAt ? date(contract.endAt) : '长期' }}</strong
              >
            </div>
            <div v-if="contract.revenueRate != null">
              <span>分红比例</span
              ><strong class="contracts-green"
                >{{ (contract.revenueRate * 100).toFixed(0) }}%</strong
              >
            </div>
            <div v-if="contract.guaranteeAmount != null">
              <span>保底金额</span
              ><strong class="contracts-orange">¥{{ money(contract.guaranteeAmount) }}</strong>
            </div>
            <div v-if="contract.buyoutAmount != null">
              <span>买断金额</span><strong>¥{{ money(contract.buyoutAmount) }}</strong>
            </div>
            <div>
              <span>累计打款</span
              ><strong class="contracts-green">¥{{ money(contract.totalPaid) }}</strong>
            </div>
            <div>
              <span>打款记录</span><strong>{{ contract.settlementLogs?.length || 0 }} 笔</strong>
            </div>
            <div>
              <span>录入人</span><strong>{{ contract.createdBy || '—' }}</strong>
            </div>
          </div>
          <div class="contracts-actions">
            <button class="review-btn ghost small" type="button" @click="openEdit(contract)">
              详情 / 编辑</button
            ><button class="review-btn black small" type="button" @click="openPayment(contract)">
              录入打款</button
            ><button
              v-if="contract.status === 'active'"
              class="review-btn red small"
              type="button"
              :disabled="busy"
              @click="terminate(contract)"
            >
              终止
            </button>
          </div>
        </article>
        <div v-if="!loading && !error && totalPages > 1" class="contracts-pagination">
          <span>共 {{ total }} 份合同</span>
          <div>
            <button
              class="review-page-btn"
              type="button"
              :disabled="page <= 1"
              @click="load(page - 1)"
            >
              ‹</button
            ><button
              v-for="number in paginationButtons"
              :key="number"
              class="review-page-btn"
              :class="{ active: number === page }"
              type="button"
              @click="load(number)"
            >
              {{ number }}</button
            ><button
              class="review-page-btn"
              type="button"
              :disabled="page >= totalPages"
              @click="load(page + 1)"
            >
              ›
            </button>
          </div>
        </div>
      </div>
    </main>
    <div v-if="drawer" class="review-drawer-overlay" @click="closeDrawer"></div>
    <aside class="review-drawer contracts-drawer" :class="{ open: !!drawer }">
      <div class="review-drawer-header">
        <strong>{{
          drawer === 'payment'
            ? `录入打款 — ${selected?.creatorName || ''}`
            : drawer === 'edit'
              ? '合同详情'
              : '新建合同'
        }}</strong
        ><button
          class="review-drawer-close"
          type="button"
          aria-label="关闭抽屉"
          @click="closeDrawer"
        >
          ✕
        </button>
      </div>
      <div class="review-drawer-body">
        <div v-if="detailLoading" class="review-loading">正在加载…</div>
        <div v-else-if="detailError" class="review-loading">{{ detailError }}</div>
        <template v-else-if="drawer === 'payment'"
          ><label class="contracts-field"
            >打款金额（元）<input
              v-model="paymentAmount"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00" /></label
          ><label class="contracts-field"
            >备注<input
              v-model="paymentNote"
              maxlength="200"
              placeholder="如：2026年4月份结算" /></label
          ><label class="contracts-field"
            >打款日期<input v-model="paymentDate" type="date" /></label></template
        ><template v-else
          ><section class="contracts-form-section">
            <h2>基本信息</h2>
            <div class="contracts-form-grid two">
              <label class="contracts-field"
                >合作方名称<input
                  v-model="form.creatorName"
                  maxlength="100"
                  placeholder="IP方/创作者名称" /></label
              ><label class="contracts-field"
                >合作类型<select v-model="form.contractType">
                  <option v-for="item in types" :key="item.value" :value="item.value">
                    {{ item.label }}
                  </option>
                </select></label
              >
            </div>
            <div class="contracts-form-grid three">
              <label class="contracts-field"
                >分红比例（%）<input
                  v-model="form.revenueRate"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  placeholder="如 25" /></label
              ><label class="contracts-field"
                >保底金额（元）<input v-model="form.guaranteeAmount" type="number" min="0" /></label
              ><label class="contracts-field"
                >买断金额（元）<input v-model="form.buyoutAmount" type="number" min="0"
              /></label>
            </div>
            <div class="contracts-form-grid two">
              <label class="contracts-field"
                >合同开始日期<input v-model="form.startAt" type="date" /></label
              ><label class="contracts-field"
                >合同结束日期（留空=长期）<input v-model="form.endAt" type="date"
              /></label>
            </div>
          </section>
          <section class="contracts-form-section">
            <h2>条款与备注</h2>
            <label class="contracts-field"
              >核心条款摘要<textarea
                v-model="form.terms"
                rows="4"
                placeholder="录入合同核心条款，如分红计算方式、结算周期、排他约定等"
              ></textarea></label
            ><label class="contracts-field"
              >内部备注<textarea v-model="form.note" rows="2" placeholder="内部备注"></textarea>
            </label>
          </section>
          <section v-if="drawer === 'edit' && selected" class="contracts-form-section">
            <h2>打款记录（共 ¥{{ money(selected.totalPaid) }}）</h2>
            <div v-if="!selected.settlementLogs?.length" class="contracts-no-logs">
              暂无打款记录
            </div>
            <div v-for="log in selected.settlementLogs" :key="log.id" class="contracts-log">
              <span>💰</span>
              <div>
                <strong>¥{{ money(log.amount) }}</strong
                ><small>{{ log.note || '—' }}</small>
              </div>
              <time>{{ date(log.settledAt) }}</time>
            </div>
          </section></template
        >
      </div>
      <div v-if="!detailLoading && !detailError" class="review-drawer-footer">
        <button
          class="review-btn yellow"
          type="button"
          :disabled="busy"
          @click="drawer === 'payment' ? submitPayment() : submitForm()"
        >
          {{
            drawer === 'payment' ? '确认录入' : drawer === 'edit' ? '保存修改' : '保存合同'
          }}</button
        ><button class="review-btn ghost" type="button" :disabled="busy" @click="closeDrawer">
          {{ drawer === 'edit' ? '关闭' : '取消' }}
        </button>
      </div>
    </aside>
    <div v-if="notice" class="review-toast" role="status">{{ notice }}</div>
  </div>
</template>
