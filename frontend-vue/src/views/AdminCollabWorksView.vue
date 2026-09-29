<script setup lang="ts">
/* eslint-disable vue/html-closing-bracket-newline, vue/html-indent, vue/multiline-html-element-content-newline */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AdminSidebar from '@/components/AdminSidebar.vue'
import { safeImageUrl } from '@/shared/media/safe-image-url'
import {
  changeCollabShelf,
  getManagedCollabWork,
  listFramePacks,
  listManagedCollabWorks,
  updateFramePack,
  sizesOf,
  type FramePack,
  type ManagedCollabWork,
  type ShelfStatus
} from '@/features/admin-collab-works/api'
import './admin-collab-shell.css'
import './admin-collab-works.css'

const router = useRouter()
const mobileOpen = ref(false)
const collapsed = ref(false)
const works = ref<ManagedCollabWork[]>([])
const filter = ref<ShelfStatus>('on_sale')
const search = ref('')
const loading = ref(true)
const error = ref('')
const detail = ref<ManagedCollabWork | null>(null)
const packs = ref<FramePack[]>([])
const detailOpen = ref(false)
const detailLoading = ref(false)
const detailError = ref('')
const modal = ref<'delist' | 'relist' | 'stock' | null>(null)
const target = ref<ManagedCollabWork | null>(null)
const stockSize = ref('')
const stockType = ref<FramePack['stockType']>('on_demand')
const stockQty = ref('')
const delistReason = ref('')
const delistNotice = ref('')
const busy = ref(false)
const notice = ref('')
let listSequence = 0
let detailSequence = 0
let noticeTimer: number | undefined
let stockRequestId = ''
const states: Array<{ key: ShelfStatus; title: string; sub: string }> = [
  { key: 'on_sale', title: '在售', sub: '正常销售中' },
  { key: 'suspended', title: '暂停中', sub: '管理员暂停' },
  { key: 'off_shelf', title: '已下架', sub: '永久停售' }
]
const counts = computed(() =>
  Object.fromEntries(
    states.map(({ key }) => [key, works.value.filter((work) => work.shelfStatus === key).length])
  )
)
const visible = computed(() =>
  works.value.filter(
    (work) =>
      work.shelfStatus === filter.value &&
      (!search.value.trim() ||
        `${work.title} ${work.creator?.nickname || ''}`
          .toLowerCase()
          .includes(search.value.trim().toLowerCase()))
  )
)
const missingSizes = computed(() =>
  detail.value
    ? sizesOf(detail.value).filter((size) => !packs.value.some((pack) => pack.size === size))
    : []
)
function shelfLabel(work: ManagedCollabWork): string {
  return work.shelfStatus === 'on_sale'
    ? '在售'
    : work.shelfStatus === 'suspended'
      ? '暂停中'
      : work.offShelfType === 'platform_force'
        ? '平台下架'
        : '已下架'
}
function suspendedDays(work: ManagedCollabWork): number {
  if (!work.suspendedAt) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(work.suspendedAt).getTime()) / 86400000))
}
function date(value?: string | null): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString('zh-CN')
}
function flash(message: string): void {
  notice.value = message
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => {
    notice.value = ''
  }, 2800)
}
async function loadWorks(): Promise<void> {
  const sequence = ++listSequence
  loading.value = true
  error.value = ''
  try {
    const result = await listManagedCollabWorks()
    if (sequence === listSequence) works.value = result
  } catch (cause) {
    if (sequence === listSequence) error.value = cause instanceof Error ? cause.message : '加载失败'
  } finally {
    if (sequence === listSequence) loading.value = false
  }
}
async function openDetail(work: ManagedCollabWork): Promise<void> {
  const sequence = ++detailSequence
  detailOpen.value = true
  detailLoading.value = true
  detailError.value = ''
  detail.value = null
  try {
    const [nextWork, nextPacks] = await Promise.all([
      getManagedCollabWork(work.id),
      listFramePacks(work.id)
    ])
    if (sequence !== detailSequence) return
    detail.value = nextWork
    packs.value = nextPacks
  } catch (cause) {
    if (sequence === detailSequence)
      detailError.value = cause instanceof Error ? cause.message : '加载失败'
  } finally {
    if (sequence === detailSequence) detailLoading.value = false
  }
}
function closeDetail(): void {
  ++detailSequence
  detailOpen.value = false
  detail.value = null
}
function openProduct(work: ManagedCollabWork): void {
  void router.push({ name: 'admin-collab-product', params: { id: work.id } })
}
async function runShelf(work: ManagedCollabWork, action: 'suspend' | 'resume'): Promise<void> {
  if (busy.value) return
  const question =
    action === 'suspend'
      ? `确认暂停《${work.title}》的销售？\n暂停后不接受新订单。`
      : `确认恢复《${work.title}》上架？`
  if (!window.confirm(question)) return
  busy.value = true
  try {
    await changeCollabShelf(work.id, action)
    flash(action === 'suspend' ? '✓ 已暂停销售' : '✓ 已恢复上架')
    closeDetail()
    await loadWorks()
  } catch (cause) {
    flash(`操作失败：${cause instanceof Error ? cause.message : '网络错误'}`)
  } finally {
    busy.value = false
  }
}
function openModal(work: ManagedCollabWork, type: 'delist' | 'relist'): void {
  target.value = work
  modal.value = type
  delistReason.value = ''
  delistNotice.value = ''
}
async function submitShelf(): Promise<void> {
  if (busy.value || !target.value || !modal.value || modal.value === 'stock') return
  if (modal.value === 'delist' && (!delistReason.value.trim() || !delistNotice.value.trim())) {
    flash(!delistReason.value.trim() ? '请填写内部备注' : '请填写给创作者的通知')
    return
  }
  const action = modal.value === 'delist' ? 'force-delist' : 'relist'
  busy.value = true
  try {
    await changeCollabShelf(
      target.value.id,
      action,
      action === 'force-delist'
        ? { reason: delistReason.value.trim(), notice: delistNotice.value.trim() }
        : {}
    )
    flash(action === 'force-delist' ? '✓ 已强制下架并记录告知内容' : '✓ 已重新上架')
    modal.value = null
    closeDetail()
    await loadWorks()
  } catch (cause) {
    flash(`操作失败：${cause instanceof Error ? cause.message : '网络错误'}`)
  } finally {
    busy.value = false
  }
}
function openStock(work: ManagedCollabWork, size: string, type: FramePack['stockType']): void {
  target.value = work
  stockSize.value = size
  stockType.value = type
  stockQty.value = ''
  stockRequestId = crypto.randomUUID()
  modal.value = 'stock'
}
async function submitStock(): Promise<void> {
  if (busy.value || !target.value) return
  const rawQuantity = String(stockQty.value).trim()
  const quantity = rawQuantity ? Number(rawQuantity) : 0
  if (!Number.isInteger(quantity)) {
    flash('调整数量必须是整数')
    return
  }
  busy.value = true
  try {
    await updateFramePack(
      target.value.id,
      stockSize.value,
      stockType.value,
      quantity,
      stockRequestId
    )
    flash('✓ 已更新')
    modal.value = null
    stockRequestId = ''
    await openDetail(target.value)
  } catch (cause) {
    flash(`库存调整失败：${cause instanceof Error ? cause.message : '网络错误'}`)
  } finally {
    busy.value = false
  }
}
watch(detailOpen, (open) => {
  document.body.style.overflow = open ? 'hidden' : ''
})
onMounted(() => {
  void loadWorks()
})
onBeforeUnmount(() => {
  window.clearTimeout(noticeTimer)
  document.body.style.overflow = ''
})
</script>

<template>
  <div class="admin-collab-shell admin-collab-works-page">
    <AdminSidebar v-model:collapsed="collapsed" v-model:mobile-open="mobileOpen" />
    <main class="review-main" :class="{ expanded: collapsed }">
      <header class="review-topbar">
        <button class="review-menu" type="button" aria-label="打开菜单" @click="mobileOpen = true">
          ☰</button
        ><span class="review-topbar-title">联名作品管理</span>
        <div class="review-topbar-right">
          <button class="review-btn ghost small" type="button" @click="loadWorks">↻ 刷新</button>
        </div>
      </header>
      <div class="review-content">
        <div class="works-stats">
          <button
            v-for="state in states"
            :key="state.key"
            class="works-stat"
            :class="{ active: filter === state.key }"
            type="button"
            @click="filter = state.key"
          >
            <span>{{ state.title }}</span
            ><strong>{{ counts[state.key] }}</strong
            ><small>{{ state.sub }}</small>
          </button>
        </div>
        <div class="works-search">
          <input
            v-model="search"
            type="search"
            placeholder="搜索作品标题或创作者名称…"
            aria-label="搜索作品标题或创作者名称"
          />
        </div>
        <div class="works-grid">
          <div v-if="loading" class="review-loading">正在加载…</div>
          <div v-else-if="error" class="review-empty">
            加载失败：{{ error }}
            <button class="review-btn ghost small" type="button" @click="loadWorks">重试</button>
          </div>
          <div v-else-if="!visible.length" class="review-empty">
            <div class="review-empty-icon">📭</div>
            暂无作品
          </div>
          <article
            v-for="work in loading || error ? [] : visible"
            :key="work.id"
            class="works-card"
          >
            <div class="works-cover">
              <img
                v-if="safeImageUrl(work.coverUrl)"
                :src="safeImageUrl(work.coverUrl)!"
                alt="封面"
              /><span v-else>🎨</span
              ><b class="works-badge" :class="work.shelfStatus || ''">{{ shelfLabel(work) }}</b>
            </div>
            <div class="works-body">
              <div class="works-title">{{ work.title }}</div>
              <div class="works-creator">👤 {{ work.creator?.nickname || '未知创作者' }}</div>
              <div class="works-id">#{{ work.id.slice(-6).toUpperCase() }}</div>
              <div class="works-meta">
                <span
                  v-if="work.shelfStatus === 'suspended' && work.suspendedAt"
                  class="works-days"
                  :class="{ warn: suspendedDays(work) >= 75 }"
                  >⏱ 已暂停 {{ suspendedDays(work) }} 天</span
                ><span v-for="size in sizesOf(work)" :key="size" class="works-tag">{{ size }}</span
                ><span class="works-tag">{{ work.saleConfigCount || 0 }} 个可售 SKU</span>
              </div>
              <div
                v-if="work.shelfStatus === 'off_shelf' && work.offShelfNotice"
                class="works-notice"
              >
                📢 通知创作者：{{ work.offShelfNotice }}
              </div>
              <div class="works-actions">
                <button class="review-btn ghost small" type="button" @click="openDetail(work)">
                  详情</button
                ><button class="review-btn yellow small" type="button" @click="openProduct(work)">
                  编辑商品</button
                ><button
                  v-if="work.shelfStatus === 'on_sale'"
                  class="review-btn orange small"
                  type="button"
                  :disabled="busy"
                  @click="runShelf(work, 'suspend')"
                >
                  暂停销售</button
                ><button
                  v-if="work.shelfStatus === 'suspended'"
                  class="review-btn green small"
                  type="button"
                  :disabled="busy"
                  @click="runShelf(work, 'resume')"
                >
                  恢复上架</button
                ><button
                  v-if="work.shelfStatus === 'on_sale' || work.shelfStatus === 'suspended'"
                  class="review-btn red small"
                  type="button"
                  :disabled="busy"
                  @click="openModal(work, 'delist')"
                >
                  强制下架</button
                ><button
                  v-if="work.shelfStatus === 'off_shelf'"
                  class="review-btn green small"
                  type="button"
                  :disabled="busy"
                  @click="openModal(work, 'relist')"
                >
                  重新上架
                </button>
              </div>
            </div>
          </article>
        </div>
      </div>
    </main>
    <div v-if="detailOpen" class="review-drawer-overlay" @click="closeDetail"></div>
    <aside class="review-drawer works-drawer" :class="{ open: detailOpen }">
      <div class="review-drawer-header">
        <strong>{{ detail?.title || '作品详情' }}</strong
        ><button
          class="review-drawer-close"
          type="button"
          aria-label="关闭详情"
          @click="closeDetail"
        >
          ✕
        </button>
      </div>
      <div class="review-drawer-body">
        <div v-if="detailLoading" class="review-loading">加载中…</div>
        <div v-else-if="detailError" class="review-loading">{{ detailError }}</div>
        <template v-else-if="detail"
          ><section class="review-section">
            <h2>基本信息</h2>
            <div class="review-detail-grid">
              <div>
                <span>创作者</span><strong>{{ detail.creator?.nickname || '—' }}</strong>
              </div>
              <div>
                <span>货架状态</span><strong>{{ shelfLabel(detail) }}</strong>
              </div>
              <div>
                <span>线下确认时间</span><strong>{{ date(detail.approvedAt) }}</strong>
              </div>
              <div v-if="detail.shelfStatus === 'suspended'">
                <span>暂停时间</span><strong>{{ date(detail.suspendedAt) }}</strong>
              </div>
              <div v-if="detail.shelfStatus === 'off_shelf'">
                <span>下架方式</span
                ><strong>{{
                  detail.offShelfType === 'platform_force' ? '平台强制下架' : '—'
                }}</strong>
              </div>
              <div v-if="detail.offShelfReason" class="review-full">
                <span>内部备注</span><strong>{{ detail.offShelfReason }}</strong>
              </div>
              <div v-if="detail.offShelfNotice" class="review-full">
                <span>创作者通知</span><strong>{{ detail.offShelfNotice }}</strong>
              </div>
            </div>
          </section>
          <section class="review-section">
            <h2>商品上架准备</h2>
            <div class="works-readiness" :class="{ ready: detail.saleReadiness?.ready }">
              <template v-if="detail.saleReadiness?.ready"
                >已满足上架条件 · {{ detail.saleSkus?.length || 0 }} 个可售 SKU</template
              ><template v-else
                >尚未满足上架条件
                <ul v-if="detail.saleReadiness?.blockers?.length">
                  <li v-for="blocker in detail.saleReadiness.blockers" :key="blocker">
                    {{ blocker }}
                  </li>
                </ul></template
              >
            </div>
            <button class="review-btn yellow small" type="button" @click="openProduct(detail)">
              进入商品工作区
            </button>
          </section>
          <section class="review-section">
            <h2>帧图预览（前10帧）</h2>
            <div v-if="detail.animationFrames?.length" class="review-frames">
              <div
                v-for="(url, index) in detail.animationFrames.slice(0, 10)"
                :key="index"
                class="review-frame"
              >
                <img v-if="safeImageUrl(url)" :src="safeImageUrl(url)!" alt="帧图" />
              </div>
            </div>
            <div v-else class="review-no-frames">暂无帧图</div>
          </section>
          <section class="review-section">
            <h2>帧素材包库存</h2>
            <table v-if="packs.length" class="works-pack-table">
              <thead>
                <tr>
                  <th>尺寸</th>
                  <th>库存类型</th>
                  <th>当前库存</th>
                  <th>锁定</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="pack in packs" :key="pack.size">
                  <td>
                    <strong>{{ pack.size }}</strong>
                  </td>
                  <td>{{ pack.stockType === 'stocked' ? '有备货' : '按需' }}</td>
                  <td>{{ pack.currentStock }}</td>
                  <td>{{ pack.reservedStock }}</td>
                  <td>
                    <button
                      class="review-btn ghost small"
                      type="button"
                      @click="openStock(detail, pack.size, pack.stockType)"
                    >
                      调整
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-else class="review-no-frames">暂无帧素材包记录</div>
            <div class="works-missing">
              <button
                v-for="size in missingSizes"
                :key="size"
                class="review-btn ghost small"
                type="button"
                @click="openStock(detail, size, 'on_demand')"
              >
                + 添加 {{ size }}
              </button>
            </div>
          </section></template
        >
      </div>
      <div v-if="detail" class="review-drawer-footer works-actions">
        <button
          v-if="detail.shelfStatus === 'on_sale'"
          class="review-btn orange small"
          type="button"
          :disabled="busy"
          @click="runShelf(detail, 'suspend')"
        >
          暂停销售</button
        ><button
          v-if="detail.shelfStatus === 'suspended'"
          class="review-btn green small"
          type="button"
          :disabled="busy"
          @click="runShelf(detail, 'resume')"
        >
          恢复上架</button
        ><button
          v-if="detail.shelfStatus === 'on_sale' || detail.shelfStatus === 'suspended'"
          class="review-btn red small"
          type="button"
          :disabled="busy"
          @click="openModal(detail, 'delist')"
        >
          强制下架</button
        ><button
          v-if="detail.shelfStatus === 'off_shelf'"
          class="review-btn green small"
          type="button"
          :disabled="busy"
          @click="openModal(detail, 'relist')"
        >
          重新上架
        </button>
      </div>
    </aside>
    <div v-if="modal" class="review-modal-overlay">
      <div class="review-modal works-modal">
        <template v-if="modal === 'delist'"
          ><h2>⚠️ 强制下架</h2>
          <p>
            作品：《{{ target?.title }}》 · {{ target?.creator?.nickname || '' }} · #{{
              target?.id.slice(-6).toUpperCase()
            }}
          </p>
          <div class="works-warning">
            下架后作品立即从 showcase 移除，创作者可根据通知内容修改后重新提交。
          </div>
          <label
            >内部备注（仅管理员可见）<input
              v-model="delistReason"
              placeholder="如：动画内容违规 / 质量问题" /></label
          ><label
            >发给创作者的通知<textarea
              v-model="delistNotice"
              placeholder="描述具体问题，告知创作者可修改后重新提交…"
            ></textarea></label></template
        ><template v-else-if="modal === 'relist'"
          ><h2>重新上架</h2>
          <p>
            作品：《{{ target?.title }}》 · {{ target?.creator?.nickname || '' }} · #{{
              target?.id.slice(-6).toUpperCase()
            }}
          </p>
          <p>无需重复线下确认，上架后立即在 showcase 可见。</p></template
        ><template v-else
          ><h2>调整帧素材包库存</h2>
          <p>#{{ target?.id.slice(-6).toUpperCase() }} · 尺寸：{{ stockSize }}</p>
          <label
            >库存类型<select v-model="stockType">
              <option value="on_demand">按需生产（不备货）</option>
              <option value="stocked">有备货（管理库存）</option>
            </select></label
          ><label
            >调整数量（正数入库，负数扣减）<input
              v-model="stockQty"
              type="number"
              placeholder="如：10 或 -3" /></label
        ></template>
        <div class="works-modal-actions">
          <button class="review-btn ghost" type="button" :disabled="busy" @click="modal = null">
            取消</button
          ><button
            class="review-btn"
            :class="modal === 'delist' ? 'red' : modal === 'relist' ? 'green' : 'yellow'"
            type="button"
            :disabled="busy"
            @click="modal === 'stock' ? submitStock() : submitShelf()"
          >
            {{ modal === 'delist' ? '确认强制下架' : modal === 'relist' ? '确认上架' : '确认' }}
          </button>
        </div>
      </div>
    </div>
    <div v-if="notice" class="review-toast" role="status">{{ notice }}</div>
  </div>
</template>
