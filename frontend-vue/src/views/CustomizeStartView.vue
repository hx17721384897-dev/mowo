<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { legacyPublicUrl } from '@/config/public-links'
import CustomizeHelpDialog from '@/features/customize-start/CustomizeHelpDialog.vue'
import CustomizeProgress from '@/features/customize-start/CustomizeProgress.vue'
import GameplayDialog from '@/features/customize-start/GameplayDialog.vue'
import ModelCard from '@/features/customize-start/ModelCard.vue'
import SkuDetailDialog from '@/features/customize-start/SkuDetailDialog.vue'
import {
  getDraftQuota,
  getMachineModels,
  getReusableAnimation,
  getSkuSales
} from '@/features/customize-start/api'
import type { MachineModel, ReusableAnimation } from '@/features/customize-start/types'
import { readAccessToken } from '@/services/auth-session'
import { useSessionStore } from '@/stores/session'
import '@/features/customize-start/customize-start.css'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const models = ref<MachineModel[]>([])
const loading = ref(true)
const error = ref('')
const selectedId = ref<string | null>(null)
const reuseAsset = ref<ReusableAnimation | null>(null)
const gameplayModel = ref<MachineModel | null>(null)
const detailModel = ref<MachineModel | null>(null)
const skuSales = ref<Record<string, number>>({})
const helpOpen = ref(false)
const nextBusy = ref(false)

const selectedModel = computed(
  () => models.value.find((model) => model.id === selectedId.value) ?? null
)
const anyDialogOpen = computed(() =>
  Boolean(gameplayModel.value || detailModel.value || helpOpen.value)
)
const nextUrl = computed(() => {
  const model = selectedModel.value
  if (!model) return ''
  if (!reuseAsset.value) {
    return `${legacyPublicUrl('customize-editor')}?modelId=${encodeURIComponent(model.id)}`
  }
  const baseFrames = reuseAsset.value.baseFrameCount
  const targets = [
    ...new Set(
      model.skus.filter((sku) => sku.frameCount % baseFrames === 0).map((sku) => sku.frameCount)
    )
  ].sort((a, b) => a - b)
  const params = new URLSearchParams({
    assetId: reuseAsset.value.id,
    modelId: model.id,
    modelName: model.name,
    frames: String(baseFrames),
    targets: targets.join(',')
  })
  return `${legacyPublicUrl('customize-confirm')}?${params.toString()}`
})

watch(anyDialogOpen, (open) => {
  document.body.style.overflow = open ? 'hidden' : ''
})

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b)
}

function persistSelection(model: MachineModel): void {
  try {
    localStorage.removeItem('mowo_customize_product_map')
    localStorage.removeItem('mowo_customize_draft_id')
    if (!reuseAsset.value) localStorage.removeItem('mowo_customize_frames')
    localStorage.setItem(
      'mowo_customize_meta',
      JSON.stringify({
        id: model.id,
        modelId: model.id,
        name: model.name,
        frames: uniqueNumbers(model.skus.map((sku) => sku.frameCount)),
        sizes: [...new Set(model.skus.map((sku) => sku.size))],
        modelType: model.modelType || 'single'
      })
    )
  } catch {
    error.value = '浏览器存储不可用，请释放空间或关闭隐私限制后重试'
  }
}

function selectModel(model: MachineModel): void {
  selectedId.value = model.id
  persistSelection(model)
}

function clearSelection(): void {
  selectedId.value = null
  try {
    const selectionKeys = [
      'mowo_customize_meta',
      'mowo_customize_frames',
      'mowo_customize_draft_id',
      'mowo_customize_product_map'
    ]
    selectionKeys.forEach((key) => localStorage.removeItem(key))
  } catch {
    // 清理本地选择失败不影响用户重新选择当前页面的数据。
  }
}

function restoreSelection(): void {
  try {
    const raw = localStorage.getItem('mowo_customize_meta')
    if (!raw) return
    const saved = JSON.parse(raw) as { modelId?: unknown }
    if (typeof saved.modelId !== 'string') return
    const model = models.value.find((candidate) => candidate.id === saved.modelId)
    if (model) selectModel(model)
  } catch {
    // 无效或不可读的旧选择直接忽略，避免阻断款式列表。
  }
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  const assetId = typeof route.query.assetId === 'string' ? route.query.assetId : ''
  if (assetId) {
    await session.bootstrap()
    if (!session.isAuthenticated) {
      await router.replace({ name: 'home', query: { auth: '1', redirect: route.fullPath } })
      return
    }
    try {
      reuseAsset.value = await getReusableAnimation(assetId)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '动画资产加载失败'
      loading.value = false
      return
    }
  }
  try {
    const loaded = await getMachineModels()
    models.value = reuseAsset.value
      ? loaded.filter((model) =>
          model.skus.some((sku) => sku.frameCount % reuseAsset.value!.baseFrameCount === 0)
        )
      : loaded
    if (!models.value.length) {
      error.value = reuseAsset.value ? '当前没有适合这个动画帧数的在售款式' : '暂无可用款式'
    } else {
      restoreSelection()
    }
  } catch {
    error.value = '加载失败，请刷新页面重试'
  } finally {
    loading.value = false
  }
}

function openGameplay(model: MachineModel): void {
  gameplayModel.value = model
}

async function openDetails(model: MachineModel): Promise<void> {
  gameplayModel.value = null
  detailModel.value = model
  skuSales.value = {}
  try {
    skuSales.value = await getSkuSales(model.id)
  } catch {
    skuSales.value = {}
  }
}

function chooseFromGameplay(): void {
  if (gameplayModel.value) selectModel(gameplayModel.value)
  gameplayModel.value = null
}

async function goNext(): Promise<void> {
  if (!nextUrl.value || nextBusy.value) return
  nextBusy.value = true
  try {
    if (readAccessToken() && !reuseAsset.value) {
      try {
        const quota = await getDraftQuota()
        if (!quota.canCreate) {
          window.alert(
            `草稿箱已达上限（${quota.count}/${quota.limit} 个）\n\n请先前往「我的动画」删除不需要的草稿，再开始新的定制。`
          )
          return
        }
      } catch {
        // 与旧流程一致：配额接口暂时不可达时不阻断进入编辑器，最终创建仍由后端校验。
      }
    }
    window.location.assign(nextUrl.value)
  } finally {
    nextBusy.value = false
  }
}

function handleEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  detailModel.value = null
  gameplayModel.value = null
  helpOpen.value = false
}

onMounted(() => {
  document.addEventListener('keydown', handleEscape)
  void load()
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleEscape)
  document.body.style.overflow = ''
})
</script>

<template>
  <div class="customize-start-page">
    <CustomizeProgress :reuse="Boolean(reuseAsset)" />

    <main class="page-wrap">
      <header class="page-header">
        <div class="page-header-left">
          <p class="page-eyebrow">
            {{ reuseAsset ? '选择新款式 · 使用已有动画' : '第一步 · 共四步' }}
          </p>
          <h1 class="page-title">选择你的动盒款式</h1>
          <p class="page-sub">
            {{
              reuseAsset ? '选择新的产品款式，原动画不会被修改' : '不同尺寸与玩法，满足你的创作灵感'
            }}
          </p>
        </div>
        <button class="btn-how-to-play" type="button" @click="helpOpen = true">
          <span class="btn-how-to-play-icon">▷</span>怎么玩？
        </button>
      </header>

      <div v-if="reuseAsset" id="reuseBanner" class="reuse-banner show">
        <span
          >正在使用 <strong>{{ reuseAsset.title }}</strong
          >（{{ reuseAsset.assetNo }} · V{{
            reuseAsset.currentVersionNo
          }}）再次制作，仅显示帧数兼容的款式。</span
        >
      </div>

      <section class="cards-section" aria-live="polite">
        <div v-if="loading" class="cards-grid" aria-label="正在加载款式">
          <article v-for="index in 4" :key="index" class="model-card skeleton">
            <div class="model-card-visual">
              <div class="mock-wrap">
                <div class="mock-cylinder"><div class="mock-ring"></div></div>
              </div>
            </div>
            <div class="model-card-body">
              <div class="skel-bar skel-title"></div>
              <div class="skel-bar skel-full"></div>
              <div class="skel-bar skel-short"></div>
            </div>
          </article>
        </div>
        <div v-else-if="error" class="cards-grid">
          <div class="cards-empty">{{ error }}</div>
        </div>
        <div v-else class="cards-grid">
          <ModelCard
            v-for="model in models"
            :key="model.id"
            :model="model"
            :selected="selectedId === model.id"
            @select="selectModel(model)"
            @gameplay="openGameplay(model)"
          />
        </div>
      </section>
    </main>

    <div id="bottomBar" class="bottom-bar" :class="{ visible: selectedModel }">
      <div class="bottom-bar-info">
        <p class="bottom-bar-label">已选款式</p>
        <p class="bottom-bar-name">{{ selectedModel?.name || '—' }}</p>
      </div>
      <div class="bottom-bar-btns">
        <button class="btn btn-secondary btn-sm" type="button" @click="clearSelection">
          重新选择
        </button>
        <button
          id="nextBtn"
          class="btn btn-primary btn-sm"
          type="button"
          :disabled="nextBusy"
          @click="goNext"
        >
          下一步 →
        </button>
      </div>
    </div>

    <SkuDetailDialog :model="detailModel" :sales="skuSales" @close="detailModel = null" />
    <GameplayDialog
      :model="gameplayModel"
      @close="gameplayModel = null"
      @select="chooseFromGameplay"
      @details="gameplayModel && openDetails(gameplayModel)"
    />
    <CustomizeHelpDialog :open="helpOpen" @close="helpOpen = false" />
  </div>
</template>
