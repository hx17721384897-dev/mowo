<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { legacyPublicUrl } from '@/config/public-links'
import { getMyCustomization, getMyCustomizations } from '@/features/customization/api'
import {
  CUSTOMIZATION_STATUS_LABEL,
  type CustomizationDetail,
  type CustomizationStatus,
  type CustomizationSummary
} from '@/features/customization/types'

type Filter = 'ALL' | 'DRAFT' | 'PROCESSING' | 'ACTION' | 'CLOSED'

const route = useRoute()
const items = ref<CustomizationSummary[]>([])
const filter = ref<Filter>('ALL')
const loading = ref(true)
const error = ref('')
const detail = ref<CustomizationDetail | null>(null)
const detailLoading = ref(false)
const detailError = ref('')

const filters: Array<{ value: Filter; label: string }> = [
  { value: 'ALL', label: '全部' },
  { value: 'DRAFT', label: '草稿' },
  { value: 'PROCESSING', label: '处理中' },
  { value: 'ACTION', label: '待我确认' },
  { value: 'CLOSED', label: '已结束' }
]

const submitted = computed(() =>
  typeof route.query.submitted === 'string' ? route.query.submitted : ''
)
const visibleItems = computed(() => items.value.filter((item) => matchesFilter(item, filter.value)))

function matchesFilter(item: CustomizationSummary, current: Filter): boolean {
  if (current === 'ALL') return true
  if (current === 'PROCESSING')
    return ['SUBMITTED', 'REVIEWING', 'STYLE_SELECTED'].includes(item.status)
  if (current === 'ACTION')
    return ['NEEDS_SUPPLEMENT', 'OPTIONS_READY', 'FRAME_ACCEPTED'].includes(item.status)
  if (current === 'CLOSED') return ['UNAVAILABLE', 'CONFIRMED', 'CLOSED'].includes(item.status)
  return item.status === current
}

function statusClass(value: CustomizationStatus): string {
  if (['DRAFT', 'EXPIRING'].includes(value)) return 's-draft'
  if (value === 'SUBMITTED') return 's-wait'
  if (['REVIEWING', 'STYLE_SELECTED'].includes(value)) return 's-work'
  if (['NEEDS_SUPPLEMENT', 'OPTIONS_READY', 'FRAME_ACCEPTED'].includes(value)) return 's-action'
  if (value === 'CONFIRMED') return 's-ok'
  return 's-closed'
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false })
}

function reviewUrl(item: CustomizationSummary): string {
  return `${legacyPublicUrl('customize-editor')}?reviewRequestId=${encodeURIComponent(item.id)}`
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    items.value = (await getMyCustomizations()).items
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '加载失败'
  } finally {
    loading.value = false
  }
}

async function openDetail(id: string): Promise<void> {
  detail.value = null
  detailError.value = ''
  detailLoading.value = true
  try {
    detail.value = await getMyCustomization(id)
  } catch (cause) {
    detailError.value = cause instanceof Error ? cause.message : '加载失败'
  } finally {
    detailLoading.value = false
  }
}

function closeDetail(): void {
  detail.value = null
  detailError.value = ''
  detailLoading.value = false
}

onMounted(load)
</script>

<template>
  <main class="customizations-page">
    <header class="page-head">
      <div>
        <p class="eyebrow">MOWO CUSTOM</p>
        <h1 class="title">我的定制</h1>
        <p class="sub">查看草稿、人工处理进度和待确认方案</p>
      </div>
      <RouterLink class="new-btn" to="/customize">＋ 新建定制</RouterLink>
    </header>

    <div v-if="submitted" class="submitted show" role="status">
      定制需求 {{ submitted }} 已提交，可在这里查看处理进度。
    </div>

    <div class="tabs" role="tablist" aria-label="定制状态筛选">
      <button
        v-for="option in filters"
        :key="option.value"
        class="tab"
        :class="{ active: filter === option.value }"
        type="button"
        role="tab"
        :aria-selected="filter === option.value"
        @click="filter = option.value"
      >
        {{ option.label }}
      </button>
    </div>

    <div class="list" aria-live="polite">
      <div v-if="loading" class="loading">正在加载</div>
      <div v-else-if="error" class="empty">
        <p>{{ error }}</p>
        <button class="retry-btn" type="button" @click="load">重新加载</button>
      </div>
      <template v-else-if="visibleItems.length">
        <article v-for="item in visibleItems" :key="item.id" class="request">
          <div class="request-main">
            <div class="request-no">{{ item.requestNo || '未提交草稿' }}</div>
            <div class="request-name">{{ item.model?.name || '定制款式' }}</div>
            <div class="meta">
              <span class="chip">{{ item.mode === 'HUMAN' ? '人工帮忙筛选' : '自己筛选' }}</span>
              <span class="chip">第 {{ item.version }} 版</span>
              <span v-if="item.desiredSku" class="chip">
                {{ item.desiredSku.size }} · {{ item.desiredSku.material }}
              </span>
            </div>
          </div>
          <div class="request-status">
            <div class="status" :class="statusClass(item.status)">
              {{ CUSTOMIZATION_STATUS_LABEL[item.status] }}
            </div>
            <div class="time">更新于 {{ formatTime(item.updatedAt) }}</div>
          </div>
          <div class="request-actions">
            <button class="view-btn" type="button" @click="openDetail(item.id)">查看</button>
            <a
              v-if="['OPTIONS_READY', 'FRAME_ACCEPTED'].includes(item.status)"
              class="review-btn"
              :href="reviewUrl(item)"
            >
              {{ item.status === 'OPTIONS_READY' ? '确认筛帧' : '继续选款式' }}
            </a>
          </div>
        </article>
      </template>
      <div v-else class="empty">这里暂时没有定制记录</div>
    </div>

    <div
      v-if="detailLoading || detail || detailError"
      class="modal-bg open"
      role="dialog"
      aria-modal="true"
      aria-labelledby="customization-detail-title"
      @click.self="closeDetail"
      @keydown.esc="closeDetail"
    >
      <section class="modal">
        <div class="modal-head">
          <div>
            <p class="eyebrow">定制记录</p>
            <h2 id="customization-detail-title" class="modal-title">
              {{ detail?.requestNo || '未提交草稿' }}
            </h2>
          </div>
          <button class="close" type="button" aria-label="关闭定制详情" @click="closeDetail">
            ×
          </button>
        </div>
        <div class="modal-body">
          <div v-if="detailLoading" class="loading">正在加载</div>
          <div v-else-if="detailError" class="empty">{{ detailError }}</div>
          <template v-else-if="detail">
            <div class="detail-grid">
              <div>
                <div class="label">处理方式</div>
                <div class="value">{{ detail.mode === 'HUMAN' ? '人工帮忙筛选' : '自己筛选' }}</div>
              </div>
              <div>
                <div class="label">当前状态</div>
                <div class="value">{{ CUSTOMIZATION_STATUS_LABEL[detail.status] }}</div>
              </div>
              <div>
                <div class="label">款式</div>
                <div class="value">{{ detail.model?.name || '—' }}</div>
              </div>
              <div>
                <div class="label">素材版本</div>
                <div class="value">第 {{ detail.version }} 版</div>
              </div>
            </div>
            <div class="timeline">
              <div v-for="event in detail.events" :key="event.id" class="event">
                <div class="event-title">
                  {{
                    event.toStatus ? CUSTOMIZATION_STATUS_LABEL[event.toStatus] : event.eventType
                  }}
                </div>
                <div class="event-message">
                  {{ event.publicMessage || '记录已更新' }} · {{ formatTime(event.createdAt) }}
                </div>
              </div>
            </div>
          </template>
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.customizations-page {
  --white: #fff;
  --cream: #f5f3ef;
  --black: #111110;
  --gray1: #ebebea;
  --gray2: #c4c3bf;
  --gray3: #787874;
  --yellow: #f0c040;
  --orange: #e8662a;
  --green: #4f9b59;
  --blue: #397ea5;
  max-width: 1120px;
  margin: 0 auto;
  padding: 42px 24px 90px;
  color: var(--black);
  font-family: 'Nunito', 'Noto Sans SC', sans-serif;
}
.customizations-page * {
  box-sizing: border-box;
}
.customizations-page p,
.customizations-page h1,
.customizations-page h2 {
  margin: 0;
}
.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 28px;
}
.eyebrow {
  margin-bottom: 7px;
  color: var(--gray3);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.16em;
}
.title {
  font-size: 34px;
  font-weight: 900;
  letter-spacing: 0;
}
.sub {
  margin-top: 7px;
  color: var(--gray3);
  font-size: 13px;
  font-weight: 700;
}
.new-btn {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  padding: 0 20px;
  border: 0;
  border-radius: 8px;
  background: var(--black);
  color: #fff;
  font-size: 13px;
  font-weight: 900;
  text-decoration: none;
}
.submitted {
  display: none;
  padding: 14px 16px;
  margin-bottom: 20px;
  border-left: 5px solid var(--green);
  background: #ecf7ee;
  font-size: 13px;
  font-weight: 800;
}
.submitted.show {
  display: block;
}
.tabs {
  display: flex;
  gap: 6px;
  padding-bottom: 10px;
  margin-bottom: 12px;
  overflow-x: auto;
}
.tab {
  min-height: 38px;
  padding: 0 15px;
  border: 1.5px solid var(--gray1);
  border-radius: 8px;
  background: #fff;
  color: var(--gray3);
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
}
.tab.active {
  border-color: var(--black);
  background: var(--black);
  color: #fff;
}
.list {
  display: grid;
  gap: 12px;
}
.request {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(170px, 0.7fr) auto;
  align-items: center;
  gap: 18px;
  padding: 18px 20px;
  border: 1.5px solid var(--gray1);
  border-radius: 8px;
  background: #fff;
}
.request-main {
  min-width: 0;
}
.request-no {
  font-size: 16px;
  font-weight: 900;
  letter-spacing: 0.03em;
}
.request-name {
  margin-top: 6px;
  font-size: 13px;
  font-weight: 800;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 9px;
}
.chip {
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--cream);
  color: var(--gray3);
  font-size: 10px;
  font-weight: 800;
}
.status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 900;
}
.status::before {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentcolor;
  content: '';
}
.s-draft {
  color: var(--gray3);
}
.s-wait {
  color: #a66a00;
}
.s-work {
  color: var(--blue);
}
.s-action {
  color: var(--orange);
}
.s-ok {
  color: var(--green);
}
.s-closed {
  color: var(--gray3);
}
.time {
  margin-top: 7px;
  color: var(--gray3);
  font-size: 11px;
  font-weight: 700;
}
.request-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 7px;
}
.view-btn,
.review-btn {
  display: inline-flex;
  height: 36px;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 900;
}
.view-btn {
  min-width: 74px;
  border: 1.5px solid var(--gray1);
  background: #fff;
}
.view-btn:hover {
  border-color: var(--black);
}
.review-btn {
  min-width: 92px;
  padding: 0 12px;
  border: 1.5px solid var(--black);
  background: var(--black);
  color: #fff;
  text-decoration: none;
}
.empty,
.loading {
  color: var(--gray3);
  font-weight: 800;
  text-align: center;
}
.empty {
  padding: 80px 20px;
  border: 1.5px solid var(--gray1);
  border-radius: 8px;
  background: #fff;
}
.loading {
  padding: 60px;
}
.retry-btn {
  padding: 8px 16px;
  margin-top: 14px;
  border: 1.5px solid var(--gray1);
  border-radius: 8px;
  background: #fff;
  font-size: 12px;
  font-weight: 900;
}
.modal-bg {
  position: fixed;
  z-index: 1200;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgb(17 17 16 / 55%);
}
.modal-bg.open {
  display: flex;
}
.modal {
  width: min(620px, 100%);
  max-height: 88vh;
  overflow: auto;
  border-radius: 8px;
  background: #fff;
}
.modal-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 22px;
  border-bottom: 1.5px solid var(--gray1);
}
.modal-title {
  font-size: 19px;
  font-weight: 900;
}
.close {
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 50%;
  background: var(--gray1);
  font-size: 18px;
}
.modal-body {
  padding: 20px 22px;
}
.detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-bottom: 20px;
}
.label {
  margin-bottom: 4px;
  color: var(--gray3);
  font-size: 10px;
  font-weight: 800;
}
.value {
  font-size: 13px;
  font-weight: 800;
}
.timeline {
  padding-left: 18px;
  margin-left: 5px;
  border-left: 2px solid var(--gray1);
}
.event {
  position: relative;
  padding: 0 0 18px;
}
.event::before {
  position: absolute;
  top: 4px;
  left: -24px;
  width: 10px;
  height: 10px;
  border: 2px solid #fff;
  border-radius: 50%;
  background: var(--yellow);
  content: '';
}
.event-title {
  font-size: 13px;
  font-weight: 900;
}
.event-message {
  margin-top: 3px;
  color: var(--gray3);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.6;
}
@media (max-width: 720px) {
  .customizations-page {
    padding: 28px 18px 70px;
  }
  .page-head {
    align-items: flex-start;
  }
  .title {
    font-size: 28px;
  }
  .request {
    grid-template-columns: 1fr auto;
  }
  .request-status {
    grid-column: 1/2;
  }
  .request-actions {
    grid-row: 1/3;
    grid-column: 2;
    flex-direction: column;
  }
  .detail-grid {
    grid-template-columns: 1fr;
  }
}
</style>
