<script setup lang="ts">
/* eslint-disable vue/html-closing-bracket-newline, vue/multiline-html-element-content-newline, vue/html-indent */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getCollabWorks } from '@/features/collab/api'
import type { CollabCreatorFilter, CollabSort, CollabWorkSummary } from '@/features/collab/types'

const route = useRoute()
const router = useRouter()
const works = ref<CollabWorkSummary[]>([])
const creators = ref<CollabCreatorFilter[]>([])
const hasMore = ref(false)
const loading = ref(true)
const loadingMore = ref(false)
const error = ref('')
const failedImages = ref(new Set<string>())
const q = ref(typeof route.query.q === 'string' ? route.query.q.slice(0, 100) : '')
const creatorId = ref(typeof route.query.creatorId === 'string' ? route.query.creatorId : '')
const sort = ref<CollabSort>(validSort(route.query.sort))
const currentPage = ref(1)
const pageHeader = ref<HTMLElement | null>(null)
const pinned = ref(false)
const activeHoverId = ref('')
const frameIndexes = ref<Record<string, number>>({})
const revealed = ref(new Set<string>())
let requestSequence = 0
let searchTimer = 0
let frameTimer = 0
let headerObserver: IntersectionObserver | null = null
let revealObserver: IntersectionObserver | null = null
let cursorFrame = 0
let cursorDot: HTMLDivElement | null = null
let cursorRing: HTMLDivElement | null = null
let mouseX = 0
let mouseY = 0
let ringX = 0
let ringY = 0

const resultText = computed(() => {
  if (loading.value) return '加载中…'
  if (error.value) return ''
  if (!works.value.length) return hasMore.value ? '正在筛选可展示作品…' : '共 0 件作品'
  return hasMore.value
    ? `已展示 ${works.value.length} 件联名商品`
    : `共 ${works.value.length} 件联名商品`
})

function validSort(value: unknown): CollabSort {
  return ['recommended', 'latest', 'popular'].includes(String(value))
    ? (value as CollabSort)
    : 'recommended'
}

function syncFromRoute(): void {
  q.value = typeof route.query.q === 'string' ? route.query.q.slice(0, 100) : ''
  creatorId.value = typeof route.query.creatorId === 'string' ? route.query.creatorId : ''
  sort.value = validSort(route.query.sort)
}

async function syncUrl(): Promise<void> {
  const query: Record<string, string> = {}
  if (sort.value !== 'recommended') query.sort = sort.value
  if (creatorId.value) query.creatorId = creatorId.value
  if (q.value.trim()) query.q = q.value.trim().slice(0, 100)
  await router.replace({ name: 'collab-list', query })
}

async function load(reset = true): Promise<boolean> {
  if (!reset && loadingMore.value) return false
  const sequence = ++requestSequence
  if (reset) {
    loading.value = true
    currentPage.value = 1
    works.value = []
    revealed.value = new Set()
  } else loadingMore.value = true
  error.value = ''
  const requestedPage = reset ? 1 : currentPage.value + 1
  try {
    const result = await getCollabWorks({
      page: requestedPage,
      q: q.value.trim(),
      creatorId: creatorId.value,
      sort: sort.value
    })
    if (sequence !== requestSequence) return false
    works.value = reset ? result.works : works.value.concat(result.works)
    currentPage.value = requestedPage
    hasMore.value = result.hasMore
    if (result.creators.length) creators.value = result.creators
    if (reset) failedImages.value = new Set()
    await syncUrl()
    loading.value = false
    loadingMore.value = false
    await nextTick()
    observeCards()
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        revealed.value = new Set(works.value.map((work) => work.id))
      })
    })
    return true
  } catch (cause) {
    if (sequence !== requestSequence) return false
    error.value = cause instanceof Error ? cause.message : '联名作品暂时无法加载，请稍后重试'
    return false
  } finally {
    if (sequence === requestSequence) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

function selectCreator(id: string): void {
  creatorId.value = id
  void load(true)
}
function selectSort(value: CollabSort): void {
  sort.value = value
  void load(true)
}
function searchChanged(): void {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => {
    q.value = q.value.trim().slice(0, 100)
    void load(true)
  }, 300)
}
function markImageFailed(id: string): void {
  failedImages.value = new Set(failedImages.value).add(id)
}

function previewFrame(work: CollabWorkSummary): string | null {
  if (activeHoverId.value !== work.id || !work.previewFrames.length) return null
  return work.previewFrames[frameIndexes.value[work.id] ?? 0] ?? null
}
function startPreview(work: CollabWorkSummary): void {
  if (!work.previewFrames.length) return
  stopPreview()
  activeHoverId.value = work.id
  frameIndexes.value = { ...frameIndexes.value, [work.id]: 0 }
  frameTimer = window.setInterval(() => {
    frameIndexes.value = {
      ...frameIndexes.value,
      [work.id]: ((frameIndexes.value[work.id] ?? 0) + 1) % work.previewFrames.length
    }
  }, 125)
}
function stopPreview(): void {
  window.clearInterval(frameTimer)
  activeHoverId.value = ''
}
function cardClick(workId: string): void {
  void router.push({ name: 'collab-detail', params: { workId } })
}

function observeCards(): void {
  revealObserver?.disconnect()
  revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        const id = (entry.target as HTMLElement).dataset.id
        if (id) revealed.value = new Set(revealed.value).add(id)
        revealObserver?.unobserve(entry.target)
      })
    },
    { threshold: 0.08, rootMargin: '0px 0px -20px 0px' }
  )
  document.querySelectorAll<HTMLElement>('.collab-fidelity-page .work-card').forEach((card) => {
    if (!revealed.value.has(card.dataset.id ?? '')) revealObserver?.observe(card)
  })
}

function moveCursor(event: MouseEvent): void {
  mouseX = event.clientX
  mouseY = event.clientY
  if (cursorDot) {
    cursorDot.style.left = `${mouseX}px`
    cursorDot.style.top = `${mouseY}px`
  }
}
function tickCursor(): void {
  ringX += (mouseX - ringX) * 0.12
  ringY += (mouseY - ringY) * 0.12
  if (cursorRing) {
    cursorRing.style.left = `${ringX}px`
    cursorRing.style.top = `${ringY}px`
  }
  cursorFrame = window.requestAnimationFrame(tickCursor)
}
function installCursor(): void {
  if (!window.matchMedia('(pointer:fine)').matches) return
  cursorDot = document.createElement('div')
  cursorRing = document.createElement('div')
  cursorDot.className = 'mowo-cursor-dot'
  cursorRing.className = 'mowo-cursor-ring'
  document.body.append(cursorDot, cursorRing)
  document.body.classList.add('mowo-custom-cursor')
  document.addEventListener('mousemove', moveCursor)
  cursorFrame = window.requestAnimationFrame(tickCursor)
}

watch(
  () => route.fullPath,
  () => {
    const nextCreator = typeof route.query.creatorId === 'string' ? route.query.creatorId : ''
    const nextQ = typeof route.query.q === 'string' ? route.query.q.slice(0, 100) : ''
    const nextSort = validSort(route.query.sort)
    if (nextCreator === creatorId.value && nextQ === q.value && nextSort === sort.value) return
    syncFromRoute()
    void load(true)
  }
)

onMounted(() => {
  headerObserver = new IntersectionObserver(
    ([entry]) => {
      if (entry) pinned.value = !entry.isIntersecting
    },
    { threshold: 0, rootMargin: '-1px 0px 0px 0px' }
  )
  if (pageHeader.value) headerObserver.observe(pageHeader.value)
  installCursor()
  void load(true)
})
onBeforeUnmount(() => {
  requestSequence += 1
  window.clearTimeout(searchTimer)
  window.clearInterval(frameTimer)
  window.cancelAnimationFrame(cursorFrame)
  headerObserver?.disconnect()
  revealObserver?.disconnect()
  document.removeEventListener('mousemove', moveCursor)
  document.body.classList.remove('mowo-custom-cursor')
  cursorDot?.remove()
  cursorRing?.remove()
})
</script>

<template>
  <div class="collab-fidelity-page">
    <header ref="pageHeader" class="page-header">
      <div class="ph-inner">
        <h1 class="ph-title">联名作品 <span class="ph-spark">✦</span></h1>
        <p class="ph-sub">浏览经过审核并已开放展示的联名作品</p>
      </div>
    </header>

    <div class="control-bar" :class="{ pinned }">
      <div class="control-inner">
        <div class="control-top">
          <div class="search-wrap">
            <svg class="search-svg" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" /></svg
            ><input
              v-model="q"
              class="search-input"
              type="search"
              maxlength="100"
              placeholder="搜索作品或创作者…"
              @input="searchChanged"
            />
          </div>
          <div class="tags-row" aria-label="按创作者筛选">
            <button
              class="tag-pill"
              :class="{ active: !creatorId }"
              type="button"
              @click="selectCreator('')"
            >
              全部</button
            ><button
              v-for="creator in creators"
              :key="creator.id"
              class="tag-pill"
              :class="{ active: creatorId === creator.id }"
              type="button"
              @click="selectCreator(creator.id)"
            >
              @ {{ creator.name }}
            </button>
          </div>
        </div>
        <div class="control-sort">
          <div class="sort-tabs" aria-label="商品排序">
            <button
              v-for="item in [
                ['recommended', '推荐'],
                ['latest', '最新'],
                ['popular', '热门']
              ] as const"
              :key="item[0]"
              class="sort-tab"
              :class="{ active: sort === item[0] }"
              type="button"
              @click="selectSort(item[0])"
            >
              {{ item[1] }}
            </button>
          </div>
          <RouterLink to="/contact" class="incentive-link"
            >联系我们，了解创作者合作方式 →</RouterLink
          >
        </div>
      </div>
    </div>

    <main id="collab-catalog" class="main">
      <p class="result-info">{{ resultText }}</p>
      <div class="masonry" aria-live="polite">
        <template v-if="loading">
          <div v-for="index in 8" :key="index" class="skeleton-card" aria-hidden="true">
            <div class="skeleton skeleton-media" />
            <div class="skeleton-body">
              <div class="skeleton skeleton-title" />
              <div class="skeleton skeleton-title-short" />
              <div class="skeleton-footer">
                <div class="skeleton-author">
                  <div class="skeleton skeleton-avatar" />
                  <div class="skeleton skeleton-name" />
                </div>
              </div>
            </div>
          </div>
        </template>
        <p v-else-if="error" class="load-error" role="alert">加载失败，请刷新重试</p>
        <article
          v-for="work in works"
          v-else
          :key="work.id"
          class="work-card reveal"
          :class="{ on: revealed.has(work.id) }"
          :data-id="work.id"
          tabindex="0"
          @click="cardClick(work.id)"
          @keydown.enter="cardClick(work.id)"
        >
          <div class="card-media" @mouseenter="startPreview(work)" @mouseleave="stopPreview">
            <img
              v-if="work.coverUrl && !failedImages.has(work.id)"
              class="card-cover-img"
              :src="work.coverUrl"
              :alt="work.title"
              loading="lazy"
              @error="markImageFailed(work.id)"
            />
            <div v-else class="card-media-placeholder">
              {{ work.coverUrl ? '素材暂不可用' : '🎨' }}
            </div>
            <div v-if="previewFrame(work)" class="card-anim-wrap">
              <img class="af" :src="previewFrame(work) ?? ''" alt="" />
            </div>
          </div>
          <div class="card-body">
            <p class="card-title">{{ work.title || '未命名作品' }}</p>
            <p v-if="work.description" class="card-summary">{{ work.description }}</p>
            <div class="card-sale">
              <span class="card-price">¥{{ (work.minPrice ?? 0).toFixed(2) }} 起</span
              ><span class="card-spec"
                >{{ work.availableSizes.slice(0, 2).join(' / ') || '多种尺寸' }} ·
                {{ work.availableSkuCount }} 种款式<br
                  v-if="Number(work.minLeadTimeDays) > 0"
                /><template v-if="Number(work.minLeadTimeDays) > 0"
                  >最快 {{ work.minLeadTimeDays }} 天内发出</template
                ></span
              >
            </div>
            <div class="card-footer">
              <button class="card-author" type="button" @click.stop="selectCreator(work.creatorId)">
                <span class="author-avatar"
                  ><img v-if="work.creator.avatarUrl" :src="work.creator.avatarUrl" alt="" />{{
                    work.creator.avatarUrl ? '' : (work.creator.nickname || '创作者').charAt(0)
                  }}</span
                ><span class="author-name">@{{ work.creator.nickname || '创作者' }}</span></button
              ><RouterLink
                class="card-cart"
                :to="{ name: 'collab-detail', params: { workId: work.id } }"
                aria-label="查看购买"
                @click.stop
              >
                <svg viewBox="0 0 24 24">
                  <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <path d="M16 10a4 4 0 0 1-8 0" />
                </svg>
              </RouterLink>
            </div>
          </div>
        </article>
      </div>
      <div v-if="!loading && !error && !works.length" class="empty-state show">
        <div class="empty-icon">🎨</div>
        <p class="empty-title">暂无匹配作品</p>
        <p class="empty-desc">换个搜索词或创作者试试</p>
      </div>
      <div v-if="!loading && !error && hasMore" class="load-more-wrap">
        <button
          class="load-more-btn"
          :class="{ loading: loadingMore }"
          type="button"
          :disabled="loadingMore"
          @click="load(false)"
        >
          <span class="load-spinner">↻</span><span>{{ loadingMore ? '加载中…' : '加载更多' }}</span>
        </button>
      </div>
    </main>

    <section class="creator-cta">
      <div class="cta-inner">
        <div class="cta-badge">开放联名合作</div>
        <h2 class="cta-heading">你的画，也能成为动起来的礼物</h2>
        <p class="cta-desc">
          哞屋持续开放创作者联名合作。邀请测试阶段由工作人员人工核验版权与生产条件，具体上架、优惠和合作方式以双方确认记录为准。
        </p>
        <div class="cta-steps">
          <div class="cta-step">
            <span class="cta-step-num">01</span>
            <div class="cta-step-content">
              <h3>上传作品</h3>
              <p>通过定制入口上传素材，或在联络页面留下作品与联系方式</p>
            </div>
          </div>
          <div class="cta-step-sep">→</div>
          <div class="cta-step">
            <span class="cta-step-num">02</span>
            <div class="cta-step-content">
              <h3>审核上架</h3>
              <p>工作人员核验版权、生产效果和适合的标准款式</p>
            </div>
          </div>
          <div class="cta-step-sep">→</div>
          <div class="cta-step">
            <span class="cta-step-num">03</span>
            <div class="cta-step-content">
              <h3>确认合作</h3>
              <p>双方确认作品授权、商品资料和履约安排后，由工作人员统一配置上架</p>
            </div>
          </div>
        </div>
        <RouterLink to="/contact" class="cta-action">联系工作人员了解合作 →</RouterLink>
      </div>
    </section>

    <footer class="collab-footer">
      <div class="foot-row">
        <span class="foot-logo">哞屋 MOWO</span>
        <div class="foot-links">
          <RouterLink to="/about">关于我们</RouterLink
          ><RouterLink to="/products">产品介绍</RouterLink
          ><RouterLink to="/showcase">画师联名</RouterLink
          ><RouterLink to="/customize">创作中心</RouterLink
          ><RouterLink to="/contact">联络我们</RouterLink>
        </div>
      </div>
      <p class="foot-copy">© 2025 哞屋 MOWO. All rights reserved.</p>
    </footer>
  </div>
</template>
