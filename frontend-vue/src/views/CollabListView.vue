<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppState from '@/components/AppState.vue'
import { getCollabWorks } from '@/features/collab/api'
import type { CollabCreatorFilter, CollabSort, CollabWorkSummary } from '@/features/collab/types'

const route = useRoute()
const router = useRouter()
const works = ref<CollabWorkSummary[]>([])
const creators = ref<CollabCreatorFilter[]>([])
const total = ref(0)
const hasMore = ref(false)
const loading = ref(true)
const error = ref('')
const failedImages = ref(new Set<string>())
const q = ref(typeof route.query.q === 'string' ? route.query.q.slice(0, 100) : '')
const creatorId = ref(typeof route.query.creator === 'string' ? route.query.creator : '')
const sort = ref<CollabSort>(
  ['recommended', 'latest', 'popular'].includes(String(route.query.sort))
    ? (route.query.sort as CollabSort)
    : 'recommended'
)
const page = computed(() => Math.max(1, Number.parseInt(String(route.query.page ?? '1'), 10) || 1))
let requestSequence = 0
let searchTimer = 0

async function load(): Promise<void> {
  q.value = typeof route.query.q === 'string' ? route.query.q.slice(0, 100) : ''
  creatorId.value = typeof route.query.creator === 'string' ? route.query.creator : ''
  sort.value = ['recommended', 'latest', 'popular'].includes(String(route.query.sort))
    ? (route.query.sort as CollabSort)
    : 'recommended'
  const sequence = ++requestSequence
  loading.value = true
  error.value = ''
  try {
    const result = await getCollabWorks({
      page: page.value,
      q: q.value.trim(),
      creatorId: creatorId.value,
      sort: sort.value
    })
    if (sequence !== requestSequence) return
    works.value = result.works
    total.value = result.total
    hasMore.value = result.hasMore
    if (result.creators.length) creators.value = result.creators
    failedImages.value = new Set()
  } catch (cause) {
    if (sequence !== requestSequence) return
    error.value = cause instanceof Error ? cause.message : '联名商品暂时无法加载'
  } finally {
    if (sequence === requestSequence) loading.value = false
  }
}

async function updateQuery(resetPage = true): Promise<void> {
  const query: Record<string, string> = {}
  if (q.value.trim()) query.q = q.value.trim()
  if (creatorId.value) query.creator = creatorId.value
  if (sort.value !== 'recommended') query.sort = sort.value
  if (!resetPage && page.value > 1) query.page = String(page.value)
  await router.push({ name: 'collab-list', query })
}

function searchChanged(): void {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => void updateQuery(), 350)
}

function markImageFailed(id: string): void {
  failedImages.value = new Set(failedImages.value).add(id)
}

function clearFilters(): void {
  q.value = ''
  creatorId.value = ''
  sort.value = 'recommended'
  void updateQuery()
}

watch(
  () => route.fullPath,
  () => void load()
)
onMounted(load)
</script>

<template>
  <main class="collab-list-page">
    <header class="collab-hero page-width">
      <p class="section-kicker">COLLABORATION STORE</p>
      <h1>联名作品，<br />变成手边的动画。</h1>
      <p>这里只有经过审核、配置正式规格并公开上架的联名商品。</p>
    </header>

    <section class="collab-catalog page-width" aria-labelledby="catalog-title">
      <h2 id="catalog-title" class="visually-hidden">联名商品列表</h2>
      <div class="collab-filters">
        <label class="collab-search">
          <span>搜索作品或创作者</span>
          <input
            v-model="q"
            type="search"
            maxlength="100"
            placeholder="输入关键词"
            @input="searchChanged"
          />
        </label>
        <label>
          <span>创作者</span>
          <select v-model="creatorId" @change="updateQuery()">
            <option value="">全部创作者</option>
            <option v-for="creator in creators" :key="creator.id" :value="creator.id">
              {{ creator.name }}
            </option>
          </select>
        </label>
        <label>
          <span>排序</span>
          <select v-model="sort" @change="updateQuery()">
            <option value="recommended">推荐</option>
            <option value="latest">最新</option>
            <option value="popular">热门</option>
          </select>
        </label>
      </div>

      <AppState v-if="loading" kind="loading" title="正在加载联名商品" detail="请稍候。" />
      <AppState v-else-if="error" kind="error" title="联名商品暂时无法加载" :detail="error">
        <button class="state-action" type="button" @click="load">重新加载</button>
      </AppState>
      <AppState
        v-else-if="!works.length"
        kind="empty"
        title="没有找到符合条件的作品"
        detail="可以清除筛选条件后再试。"
      >
        <button class="state-action" type="button" @click="clearFilters">清除筛选</button>
      </AppState>
      <template v-else>
        <p class="collab-result-count">共 {{ total }} 件公开作品</p>
        <div class="collab-grid">
          <RouterLink
            v-for="work in works"
            :key="work.id"
            class="collab-card"
            :to="{ name: 'collab-detail', params: { workId: work.id } }"
          >
            <div class="collab-card__media">
              <img
                v-if="work.coverUrl && !failedImages.has(work.id)"
                :src="work.coverUrl"
                :alt="work.title"
                loading="lazy"
                @error="markImageFailed(work.id)"
              />
              <div v-else class="media-fallback" role="img" :aria-label="`${work.title} 暂无封面`">
                <span>MOWO</span>
              </div>
            </div>
            <div class="collab-card__body">
              <p>{{ work.creator.nickname }}</p>
              <h3>{{ work.title }}</h3>
              <p class="collab-card__description">
                {{ work.description || '查看作品规格与媒体。' }}
              </p>
              <div>
                <strong>
                  {{ work.minPrice == null ? '暂不可售' : `¥${work.minPrice.toFixed(2)} 起` }}
                </strong>
                <span>{{ work.availableSizes.join(' / ') }}</span>
              </div>
            </div>
          </RouterLink>
        </div>
        <nav class="collab-pagination" aria-label="联名商品分页">
          <RouterLink
            v-if="page > 1"
            :to="{ query: { ...route.query, page: page - 1 === 1 ? undefined : page - 1 } }"
          >
            ← 上一页
          </RouterLink>
          <span>第 {{ page }} 页</span>
          <RouterLink v-if="hasMore" :to="{ query: { ...route.query, page: page + 1 } }">
            下一页 →
          </RouterLink>
        </nav>
      </template>
    </section>
  </main>
</template>
