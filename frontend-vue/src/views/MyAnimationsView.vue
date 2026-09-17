<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { legacyPublicUrl } from '@/config/public-links'
import { deleteAnimation, getAnimationLibrary, renameAnimation } from '@/features/animation/api'
import type {
  AnimationAssetItem,
  AnimationDraftItem,
  AnimationFilter,
  AnimationItem
} from '@/features/animation/types'

const items = ref<AnimationItem[]>([])
const filter = ref<AnimationFilter>('all')
const loading = ref(true)
const error = ref('')
const renameTarget = ref<AnimationItem | null>(null)
const renameValue = ref('')
const renameBusy = ref(false)
const deleteTarget = ref<AnimationItem | null>(null)
const deleteBusy = ref(false)
const toast = ref('')
const renameInput = ref<HTMLInputElement | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | undefined

const filters: Array<{ value: AnimationFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'asset', label: '动画资产' },
  { value: 'draft', label: '草稿' }
]

const visibleItems = computed(() =>
  filter.value === 'all' ? items.value : items.value.filter((item) => item.kind === filter.value)
)

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

function formatDatetimeMinute(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function draftStatusLabel(status: AnimationDraftItem['status']): string {
  return { draft: '草稿', in_cart: '已加购', ordered: '已下单' }[status]
}

function draftStatusClass(status: AnimationDraftItem['status']): string {
  if (status === 'ordered') return 'status-done'
  if (status === 'in_cart') return 'status-making'
  return 'status-pending'
}

function draftSpec(item: AnimationDraftItem): string {
  const parts = [
    item.modelName,
    item.size,
    item.frameCount ? `${item.frameCount}帧` : null,
    item.material,
    item.colorName
  ].filter(Boolean)
  return parts.join(' ') || `定制动画 ${formatDatetimeMinute(item.createdAt)}`
}

function displayName(item: AnimationItem): string {
  return item.kind === 'asset' ? item.title : item.title || draftSpec(item)
}

function daysLeft(item: AnimationDraftItem): number | null {
  if (!item.draftExpiresAt) return null
  const expiry = new Date(item.draftExpiresAt).getTime()
  if (Number.isNaN(expiry)) return null
  return Math.max(0, Math.ceil((expiry - Date.now()) / 86_400_000))
}

function draftExpiryLabel(item: AnimationDraftItem): string {
  const days = daysLeft(item)
  return days && days > 0 ? `${days}天` : '已过期'
}

function editorUrl(item: AnimationItem): string {
  const parameter = item.kind === 'asset' ? 'assetId' : 'editId'
  return `${legacyPublicUrl('customize-editor')}?${parameter}=${encodeURIComponent(item.id)}`
}

function reuseUrl(item: AnimationAssetItem): string {
  return `/app/customize?assetId=${encodeURIComponent(item.id)}`
}

function showToast(message: string): void {
  toast.value = message
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 2400)
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    items.value = (await getAnimationLibrary()).items
  } catch {
    error.value = '加载失败，请检查网络后重试'
  } finally {
    loading.value = false
  }
}

async function openRename(item: AnimationItem): Promise<void> {
  renameTarget.value = item
  renameValue.value = displayName(item)
  await nextTick()
  renameInput.value?.focus()
  renameInput.value?.select()
}

function closeRename(): void {
  if (renameBusy.value) return
  renameTarget.value = null
  renameValue.value = ''
}

async function confirmRename(): Promise<void> {
  const target = renameTarget.value
  const title = renameValue.value.trim()
  if (!target) return
  if (!title) {
    showToast('请输入名称')
    return
  }
  renameBusy.value = true
  try {
    await renameAnimation(target, title)
    if (target.kind === 'asset') target.title = title
    else target.title = title
    renameTarget.value = null
    renameValue.value = ''
    showToast('已重命名')
  } catch (cause) {
    showToast(`重命名失败：${cause instanceof Error ? cause.message : '请稍后重试'}`)
  } finally {
    renameBusy.value = false
  }
}

function openDelete(item: AnimationItem): void {
  deleteTarget.value = item
}

function closeDelete(): void {
  if (!deleteBusy.value) deleteTarget.value = null
}

async function confirmDelete(): Promise<void> {
  const target = deleteTarget.value
  if (!target) return
  deleteBusy.value = true
  try {
    await deleteAnimation(target)
    items.value = items.value.filter((item) => item.id !== target.id || item.kind !== target.kind)
    deleteTarget.value = null
    showToast('已删除')
  } catch (cause) {
    showToast(`删除失败：${cause instanceof Error ? cause.message : '请稍后重试'}`)
  } finally {
    deleteBusy.value = false
  }
}

function handleEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  if (renameTarget.value) closeRename()
  else if (deleteTarget.value) closeDelete()
}

onMounted(() => {
  document.addEventListener('keydown', handleEscape)
  void load()
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleEscape)
  if (toastTimer) clearTimeout(toastTimer)
})
</script>

<template>
  <main class="animations-page">
    <div class="page-header">
      <h1 class="page-title">我的<em>动画</em></h1>
      <p class="page-sub">你通过定制工具创作的每一帧热爱</p>
    </div>

    <div class="filter-bar" role="tablist" aria-label="动画分类筛选">
      <button
        v-for="option in filters"
        :key="option.value"
        class="filter-btn"
        :class="{ active: filter === option.value }"
        type="button"
        role="tab"
        :aria-selected="filter === option.value"
        @click="filter = option.value"
      >
        {{ option.label }}
      </button>
      <span class="filter-count">共 {{ items.length }} 件</span>
    </div>

    <div aria-live="polite">
      <div v-if="loading" class="anim-grid" aria-label="正在加载">
        <div v-for="index in 6" :key="index" class="anim-card">
          <div class="sk-thumb skeleton"></div>
          <div class="sk-body">
            <div class="sk-line skeleton"></div>
            <div class="sk-line w60 skeleton"></div>
          </div>
        </div>
      </div>

      <div v-else-if="error" class="error-state">
        <div class="error-icon">⚠️</div>
        <p class="error-msg">{{ error }}</p>
        <button class="btn-retry" type="button" @click="load">重新加载</button>
      </div>

      <div v-else-if="!visibleItems.length" class="empty-state">
        <div class="empty-icon">🎬</div>
        <p class="empty-title">{{ filter === 'all' ? '还没有定制记录' : '该分类暂无记录' }}</p>
        <p class="empty-sub">
          {{ filter === 'all' ? '去定制你的第一台专属动画机吧！' : '换个分类看看？' }}
        </p>
        <RouterLink v-if="filter === 'all'" class="btn-go" to="/customize"> 开始定制 → </RouterLink>
      </div>

      <div v-else class="anim-grid">
        <article v-for="item in visibleItems" :key="`${item.kind}:${item.id}`" class="anim-card">
          <div class="card-thumb">
            <img
              v-if="item.previewUrl"
              :src="item.previewUrl"
              alt="预览"
              loading="lazy"
              class="preview-image"
            />
            <div v-else class="card-thumb-placeholder">
              <div class="card-thumb-icon">🎞️</div>
              <div class="card-thumb-label">动画预览</div>
            </div>
            <div class="card-status">
              <span v-if="item.kind === 'asset'" class="status-pill status-shipped">{{
                item.assetType === 'COLLAB' ? '联名动画' : '动画资产'
              }}</span>
              <span v-else class="status-pill" :class="draftStatusClass(item.status)">
                {{ draftStatusLabel(item.status) }}
              </span>
            </div>
            <div v-if="item.frameCount" class="card-thumb-frames">{{ item.frameCount }}帧</div>
          </div>

          <div class="card-body">
            <div class="card-name-row">
              <div class="card-model">{{ displayName(item) }}</div>
              <button
                class="rename-btn"
                type="button"
                title="修改动画名称"
                @click="openRename(item)"
              >
                <span aria-hidden="true">✎</span>重命名
              </button>
            </div>
            <div class="card-meta">
              <template v-if="item.kind === 'asset'">
                <span class="card-meta-item">{{ item.assetNo }}</span>
                <span class="card-meta-item">V{{ item.currentVersionNo }}</span>
              </template>
              <span v-else-if="daysLeft(item) !== null" class="card-meta-item">
                🗂 工程{{ draftExpiryLabel(item) }}
              </span>
              <span class="card-meta-item">📅 {{ formatDate(item.createdAt) }}</span>
            </div>
          </div>

          <div class="card-footer">
            <div v-if="item.kind === 'asset'" class="asset-actions">
              <a v-if="item.assetType === 'PRIVATE'" :href="editorUrl(item)" class="asset-edit-btn">
                修改动画
              </a>
              <a :href="reuseUrl(item)" class="asset-reuse-btn">选择新款式 →</a>
            </div>
            <div v-else class="asset-actions">
              <a :href="editorUrl(item)" class="card-link">✏️ 重新编辑</a>
              <RouterLink to="/customize" class="card-link">去选配 →</RouterLink>
            </div>
            <button class="card-delete-btn" type="button" @click="openDelete(item)">删除</button>
          </div>
        </article>
      </div>
    </div>

    <div
      class="modal-overlay"
      :class="{ open: renameTarget }"
      :aria-hidden="!renameTarget"
      :inert="!renameTarget"
      @click.self="closeRename"
    >
      <section
        class="confirm-modal rename-modal"
        role="dialog"
        aria-modal="true"
        aria-label="重命名动画"
      >
        <p class="confirm-title rename-title">重命名动画</p>
        <input
          id="renameInput"
          ref="renameInput"
          v-model="renameValue"
          class="rename-input"
          type="text"
          maxlength="40"
          placeholder="输入动画名称"
          @keydown.enter="confirmRename"
        />
        <div class="confirm-actions">
          <button class="confirm-btn confirm-btn-cancel" type="button" @click="closeRename">
            取消
          </button>
          <button
            id="btnConfirmRename"
            class="confirm-btn confirm-btn-delete rename-save"
            type="button"
            :disabled="renameBusy"
            @click="confirmRename"
          >
            {{ renameBusy ? '保存中…' : '保存' }}
          </button>
        </div>
      </section>
    </div>

    <div
      class="modal-overlay"
      :class="{ open: deleteTarget }"
      :aria-hidden="!deleteTarget"
      :inert="!deleteTarget"
      @click.self="closeDelete"
    >
      <section class="confirm-modal" role="dialog" aria-modal="true" aria-label="删除动画">
        <div class="confirm-icon">🗑️</div>
        <p class="confirm-title">确认删除这个动画？</p>
        <p class="confirm-sub">
          <template v-if="deleteTarget?.kind === 'asset'">
            「{{ displayName(deleteTarget) }}」将从您的动画列表移除。
          </template>
          <template v-else-if="deleteTarget">
            「{{ displayName(deleteTarget) }}」删除后无法恢复。
          </template>
        </p>
        <div class="confirm-actions">
          <button class="confirm-btn confirm-btn-cancel" type="button" @click="closeDelete">
            取消
          </button>
          <button
            id="btnConfirmDelete"
            class="confirm-btn confirm-btn-delete"
            type="button"
            :disabled="deleteBusy"
            @click="confirmDelete"
          >
            {{ deleteBusy ? '删除中…' : '确认删除' }}
          </button>
        </div>
      </section>
    </div>

    <div class="toast" :class="{ show: toast }" role="status">{{ toast }}</div>
  </main>
</template>

<style scoped>
.animations-page {
  --white: #fff;
  --cream: #f5f3ef;
  --black: #111110;
  --gray1: #ebebea;
  --gray2: #c4c3bf;
  --gray3: #787874;
  --accent-y: #f5e642;
  --ease: cubic-bezier(0.22, 1, 0.36, 1);
  max-width: 860px;
  min-height: calc(100vh - 76px);
  padding: 48px 24px 100px;
  margin: 0 auto;
  color: var(--black);
  font-family: 'Nunito', 'Noto Sans SC', sans-serif;
}
.animations-page * {
  box-sizing: border-box;
}
.animations-page p,
.animations-page h1 {
  margin: 0;
}
.animations-page button {
  border: 0;
  background: none;
  font-family: inherit;
}
.page-header {
  margin-bottom: 36px;
}
.page-title {
  margin-bottom: 8px;
  font-size: clamp(26px, 5vw, 40px);
  font-weight: 900;
  line-height: 1.1;
  letter-spacing: -0.03em;
}
.page-title em {
  padding: 0 10px;
  border-radius: 8px;
  background: var(--accent-y);
  font-style: normal;
}
.page-sub {
  color: var(--gray3);
  font-size: 14px;
  font-weight: 700;
}
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 28px;
}
.filter-btn {
  min-height: 36px;
  padding: 8px 18px;
  border: 1.5px solid var(--gray1) !important;
  border-radius: 999px;
  background: var(--white) !important;
  color: var(--gray3);
  font-size: 12px;
  font-weight: 800;
  transition: all 0.2s;
}
.filter-btn:hover {
  border-color: var(--gray2) !important;
  color: var(--black);
}
.filter-btn.active {
  border-color: var(--black) !important;
  background: var(--black) !important;
  color: var(--white);
}
.filter-count {
  margin-left: auto;
  color: var(--gray3);
  font-size: 12px;
  font-weight: 700;
}
.anim-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}
.anim-card {
  overflow: hidden;
  border: 1.5px solid var(--gray1);
  border-radius: 20px;
  background: var(--white);
  cursor: pointer;
  transition:
    border-color 0.22s,
    box-shadow 0.22s,
    transform 0.22s var(--ease);
}
.anim-card:hover {
  border-color: var(--gray2);
  box-shadow: 0 8px 32px rgb(0 0 0 / 9%);
  transform: translateY(-3px);
}
.card-thumb {
  position: relative;
  display: flex;
  height: 180px;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: var(--gray1);
}
.preview-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.card-thumb-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.card-thumb-icon {
  font-size: 36px;
  opacity: 0.35;
}
.card-thumb-label {
  color: var(--gray3);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
}
.card-thumb-frames {
  position: absolute;
  right: 10px;
  bottom: 8px;
  padding: 3px 8px;
  border-radius: 999px;
  backdrop-filter: blur(4px);
  background: rgb(0 0 0 / 50%);
  color: #fff;
  font-size: 10px;
  font-weight: 800;
}
.card-status {
  position: absolute;
  top: 10px;
  left: 10px;
}
.status-pill {
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 900;
}
.status-pending {
  background: #fff8e6;
  color: #c47f00;
}
.status-making {
  background: #ebf5ff;
  color: #26c;
}
.status-shipped {
  background: #e8f9ec;
  color: #1a7a2c;
}
.status-done {
  background: var(--gray1);
  color: var(--gray3);
}
.card-body {
  padding: 14px 16px 16px;
}
.card-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.card-model {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--black);
  font-size: 14px;
  font-weight: 900;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rename-btn {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  border-radius: 6px;
  color: var(--gray3);
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
}
.rename-btn:hover {
  background: var(--gray1);
  color: var(--black);
}
.card-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.card-meta-item {
  display: flex;
  align-items: center;
  gap: 3px;
  color: var(--gray3);
  font-size: 11px;
  font-weight: 700;
}
.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px 14px;
  border-top: 1px solid var(--gray1);
  margin-top: 2px;
}
.asset-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.card-link,
.asset-edit-btn,
.asset-reuse-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--black);
  font-size: 12px;
  font-weight: 800;
  text-decoration: none;
}
.asset-edit-btn {
  color: var(--gray3);
}
.asset-reuse-btn {
  font-weight: 900;
}
.card-link:hover,
.asset-edit-btn:hover,
.asset-reuse-btn:hover {
  opacity: 0.6;
}
.card-delete-btn {
  padding: 4px 8px;
  border-radius: 8px;
  color: #c22;
  font-size: 12px;
  font-weight: 800;
}
.card-delete-btn:hover {
  background: #fff0f0;
}
.skeleton {
  animation: sk-pulse 1.5s ease-in-out infinite;
}
@keyframes sk-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}
.sk-thumb {
  height: 180px;
  border-radius: 0;
  background: var(--gray1);
}
.sk-line {
  height: 14px;
  margin-bottom: 8px;
  border-radius: 6px;
  background: var(--gray1);
}
.sk-line.w60 {
  width: 60%;
}
.sk-body {
  padding: 14px 16px 16px;
}
.empty-state,
.error-state {
  padding: 80px 24px;
  text-align: center;
}
.error-state {
  padding: 60px 24px;
}
.empty-icon {
  margin-bottom: 16px;
  font-size: 52px;
  opacity: 0.4;
}
.empty-title {
  margin-bottom: 8px !important;
  font-size: 20px;
  font-weight: 900;
}
.empty-sub {
  margin-bottom: 28px !important;
  color: var(--gray3);
  font-size: 14px;
  font-weight: 700;
  line-height: 1.7;
}
.btn-go {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 28px;
  border-radius: 999px;
  background: var(--black);
  color: var(--white);
  font-size: 14px;
  font-weight: 800;
  text-decoration: none;
}
.error-icon {
  margin-bottom: 12px;
  font-size: 40px;
}
.error-msg {
  margin-bottom: 20px !important;
  color: var(--gray3);
  font-size: 14px;
  font-weight: 700;
}
.btn-retry {
  padding: 10px 24px;
  border-radius: 999px;
  background: var(--gray1) !important;
  color: var(--black);
  font-size: 13px;
  font-weight: 800;
}
.modal-overlay {
  position: fixed;
  z-index: 1200;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  backdrop-filter: blur(8px);
  background: rgb(0 0 0 / 55%);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.25s var(--ease);
}
.modal-overlay.open {
  opacity: 1;
  pointer-events: all;
}
.confirm-modal {
  width: 100%;
  max-width: 380px;
  padding: 28px;
  border-radius: 24px;
  background: var(--white);
  transform: translateY(16px) scale(0.97);
  transition: transform 0.3s var(--ease);
}
.modal-overlay.open .confirm-modal {
  transform: none;
}
.rename-modal {
  max-width: 360px;
}
.confirm-icon {
  margin-bottom: 14px;
  font-size: 40px;
  text-align: center;
}
.confirm-title {
  margin-bottom: 8px !important;
  font-size: 18px;
  font-weight: 900;
  text-align: center;
}
.rename-title {
  margin-bottom: 16px !important;
}
.confirm-sub {
  margin-bottom: 24px !important;
  color: var(--gray3);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.6;
  text-align: center;
}
.rename-input {
  display: block;
  width: 100%;
  height: 42px;
  padding: 0 14px;
  border: 1.5px solid var(--gray1);
  border-radius: 12px;
  margin-bottom: 20px;
  outline: none;
  background: var(--white);
  color: var(--black);
  font-family: inherit;
  font-size: 13px;
  font-weight: 700;
  transition: border-color 0.2s;
}
.rename-input:focus {
  border-color: var(--black);
}
.confirm-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.confirm-btn {
  padding: 11px 0;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 800;
}
.confirm-btn-cancel {
  background: var(--gray1) !important;
  color: var(--black);
}
.confirm-btn-delete {
  border: 1.5px solid #fcc !important;
  background: #fff0f0 !important;
  color: #c22;
}
.rename-save {
  border-color: var(--black) !important;
  background: var(--black) !important;
  color: var(--white);
}
.toast {
  position: fixed;
  z-index: 9000;
  bottom: 32px;
  left: 50%;
  padding: 10px 22px;
  border-radius: 999px;
  background: var(--black);
  color: var(--white);
  font-size: 13px;
  font-weight: 800;
  opacity: 0;
  pointer-events: none;
  transform: translateX(-50%) translateY(12px);
  transition: all 0.3s var(--ease);
  white-space: nowrap;
}
.toast.show {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
@media (min-width: 1024px) {
  .animations-page {
    padding: 64px 48px 100px;
  }
}
@media (max-width: 640px) {
  .anim-grid {
    grid-template-columns: 1fr;
  }
}
</style>
