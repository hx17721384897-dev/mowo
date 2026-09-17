<script setup lang="ts">
/* eslint-disable vue/html-closing-bracket-newline, vue/html-indent */
import { computed, ref } from 'vue'
import faqHeroUrl from '../../../frontend/assets/images/faq-hero.png'
import { legacyPublicUrl } from '@/config/public-links'
import { faqCategories, faqItems } from '@/content/public-content'

const query = ref('')
const category = ref<(typeof faqCategories)[number]['id']>('all')
const openId = ref<string | null>(null)
const reversed = ref(false)

const filteredItems = computed(() => {
  const normalizedQuery = query.value.trim().toLocaleLowerCase('zh-CN')
  const rows = faqItems.filter((item) => {
    const categoryMatches = category.value === 'all' || item.category === category.value
    const queryMatches =
      !normalizedQuery ||
      `${item.question}${item.answer}`.toLocaleLowerCase('zh-CN').includes(normalizedQuery)
    return categoryMatches && queryMatches
  })
  return reversed.value ? rows.slice().reverse() : rows
})

const categoryTitle = computed(
  () => faqCategories.find((item) => item.id === category.value)?.label ?? '全部'
)

function chooseCategory(id: (typeof faqCategories)[number]['id']): void {
  category.value = id
  openId.value = null
}

function clearSearch(): void {
  query.value = ''
  openId.value = null
}
</script>

<template>
  <div class="faq-fidelity-page">
    <section class="faq-hero">
      <img class="hero-bg" :src="faqHeroUrl" alt="" aria-hidden="true" draggable="false" />
      <div class="hero-overlay" />
      <div class="hero-inner">
        <div class="hero-text">
          <h1 class="hero-title">常见问题</h1>
          <p class="hero-sub">关于产品、定制、联名合作与账号的当前说明</p>
          <label class="search-wrap">
            <span class="visually-hidden">搜索问题</span>
            <input
              v-model="query"
              class="search-input"
              type="search"
              placeholder="请输入你想了解的问题"
              autocomplete="off"
              @input="openId = null"
            />
            <button
              v-if="query"
              class="search-clear"
              type="button"
              aria-label="清除搜索"
              @click="clearSearch"
            >
              ✕
            </button>
            <span class="search-icon" aria-hidden="true">🔍</span>
          </label>
        </div>
      </div>
    </section>

    <nav class="breadcrumb" aria-label="面包屑">
      <RouterLink to="/">首页</RouterLink><span class="breadcrumb-sep">›</span
      ><RouterLink to="/contact">联络我们</RouterLink><span class="breadcrumb-sep">›</span
      ><span class="breadcrumb-cur">常见问题</span>
    </nav>

    <div class="faq-layout">
      <aside class="faq-sidebar">
        <nav class="cat-nav" aria-label="问题分类">
          <button
            v-for="item in faqCategories"
            :key="item.id"
            class="cat-item"
            :class="{ active: category === item.id }"
            type="button"
            @click="chooseCategory(item.id)"
          >
            <span class="cat-icon" aria-hidden="true">{{
              item.id === 'all'
                ? '✦'
                : item.id === 'product'
                  ? '📦'
                  : item.id === 'customization'
                    ? '✂️'
                    : item.id === 'collab'
                      ? '🎨'
                      : '👤'
            }}</span
            >{{ item.label
            }}<span class="cat-count">{{
              item.id === 'all'
                ? faqItems.length
                : faqItems.filter((faq) => faq.category === item.id).length
            }}</span>
          </button>
        </nav>
        <div class="sidebar-contact">
          <p class="sc-title">还没解决问题？</p>
          <p class="sc-sub">通过联络表单告诉工作人员<br />我们会继续协助确认</p>
          <RouterLink to="/contact" class="sc-btn">联系我们 ↗</RouterLink>
          <div class="bear-wrap">
            <svg class="bear-svg" viewBox="0 0 100 100" fill="none">
              <circle cx="50" cy="55" r="28" fill="#c0aa88" />
              <circle cx="28" cy="32" r="13" fill="#c0aa88" />
              <circle cx="72" cy="32" r="13" fill="#c0aa88" />
              <circle cx="28" cy="30" r="8" fill="#e8d8be" />
              <circle cx="72" cy="30" r="8" fill="#e8d8be" />
              <ellipse cx="50" cy="60" rx="18" ry="14" fill="#e8d8be" />
              <circle cx="41" cy="50" r="4" fill="#2c1f14" />
              <circle cx="59" cy="50" r="4" fill="#2c1f14" />
              <circle cx="42.5" cy="48.5" r="1.5" fill="#fff" />
              <circle cx="60.5" cy="48.5" r="1.5" fill="#fff" />
              <circle cx="50" cy="59" r="3" fill="#2c1f14" />
              <circle cx="75" cy="25" r="14" fill="#fff" stroke="#e8d8be" stroke-width="2" />
              <text
                x="75"
                y="31"
                text-anchor="middle"
                fill="#c0aa88"
                font-size="16"
                font-weight="900"
              >
                ?
              </text>
            </svg>
          </div>
        </div>
      </aside>

      <main class="faq-content">
        <div class="cat-tabs" role="tablist" aria-label="问题分类">
          <button
            v-for="item in faqCategories"
            :key="item.id"
            role="tab"
            :aria-selected="category === item.id"
            :class="{ active: category === item.id }"
            type="button"
            @click="chooseCategory(item.id)"
          >
            {{ item.label }}
          </button>
        </div>
        <div class="content-header">
          <span class="content-title">{{
            categoryTitle === '全部' ? '全部问题' : categoryTitle
          }}</span
          ><span class="content-count" aria-live="polite"
            >找到 {{ filteredItems.length }} 个问题</span
          ><button class="content-sort" type="button" @click="reversed = !reversed">
            {{ reversed ? '反向排序' : '默认排序' }} ↕
          </button>
        </div>
        <p v-if="query" class="search-hint">“{{ query }}” 的搜索结果</p>
        <div v-if="filteredItems.length" class="faq-list">
          <article
            v-for="item in filteredItems"
            :key="item.id"
            class="faq-item"
            :class="{ open: openId === item.id }"
          >
            <button
              class="faq-q"
              type="button"
              :aria-expanded="openId === item.id"
              @click="openId = openId === item.id ? null : item.id"
            >
              <span class="faq-q-icon">Q</span><span class="faq-q-text">{{ item.question }}</span
              ><span class="faq-q-arrow" aria-hidden="true">↓</span>
            </button>
            <div class="faq-a">
              <div class="faq-a-inner">{{ item.answer }}</div>
            </div>
          </article>
        </div>
        <div v-else class="no-results" role="status">
          <div class="nr-icon">🔍</div>
          <p class="nr-title">没有找到相关问题</p>
          <p class="nr-sub">
            试试换个关键词，或者直接<RouterLink to="/contact">联系我们</RouterLink>
          </p>
        </div>
        <div class="content-cta">
          <div>
            <p class="cta-title">没有找到你的问题？</p>
            <p class="cta-sub">尝试使用不同关键词，或通过联络表单告诉工作人员</p>
          </div>
          <RouterLink to="/contact" class="cta-btn">联系我们 ↗</RouterLink>
        </div>
      </main>
    </div>

    <footer>
      <div class="foot-grid">
        <div class="foot-brand">
          <div class="foot-logo"><span>🐄</span>哞屋 MOWO</div>
          <p class="foot-desc">让每帧热爱，都能被触摸。专注动画机定制与联名合作。</p>
        </div>
        <div class="foot-col">
          <p class="foot-col-title">关于哞屋</p>
          <div class="foot-col-links">
            <RouterLink to="/about">品牌故事</RouterLink
            ><RouterLink to="/products">产品介绍</RouterLink>
          </div>
        </div>
        <div class="foot-col">
          <p class="foot-col-title">创作与合作</p>
          <div class="foot-col-links">
            <RouterLink to="/showcase">联名商品</RouterLink
            ><a :href="legacyPublicUrl('customize-start')">私人定制</a>
          </div>
        </div>
        <div class="foot-col">
          <p class="foot-col-title">帮助中心</p>
          <div class="foot-col-links">
            <RouterLink to="/faq">常见问题</RouterLink
            ><RouterLink to="/contact">联络我们</RouterLink>
          </div>
        </div>
      </div>
      <div class="foot-bottom">
        <p>© {{ new Date().getFullYear() }} 哞屋 MOWO. All rights reserved.</p>
        <div>
          <RouterLink to="/legal/privacy">隐私政策</RouterLink
          ><RouterLink to="/legal/terms">用户协议</RouterLink>
        </div>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.faq-fidelity-page {
  --white: #fff;
  --cream: #fef3e2;
  --black: #2c1f14;
  --gray1: #e8d8be;
  --gray2: #c0aa88;
  --gray3: #7a6552;
  --accent-y: #f0c040;
  --accent-o: #e8662a;
  --pad-mob: 20px;
  --pad-desk: 72px;
  --sidebar-w: 220px;
  overflow: hidden;
  background: var(--cream);
  color: var(--black);
  font-family: Nunito, 'Noto Sans SC', sans-serif;
}
.faq-fidelity-page * {
  box-sizing: border-box;
}
.faq-fidelity-page :is(h1, h2, h3, p) {
  margin: 0;
}
.faq-fidelity-page a {
  color: inherit;
  text-decoration: none;
}
.faq-fidelity-page button {
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.faq-hero {
  position: relative;
  display: flex;
  height: 300px;
  align-items: center;
  overflow: hidden;
}
.hero-bg,
.hero-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.hero-bg {
  display: block;
  object-fit: cover;
  object-position: center;
}
.hero-overlay {
  background: linear-gradient(
    to right,
    rgb(254 243 226 / 95%),
    rgb(254 243 226 / 82%) 45%,
    rgb(254 243 226 / 25%) 75%,
    transparent
  );
}
.hero-inner {
  position: relative;
  z-index: 2;
  width: 100%;
  max-width: 1200px;
  padding: 40px var(--pad-mob);
  margin: 0 auto;
}
.hero-text {
  max-width: 520px;
}
.hero-title {
  margin-bottom: 10px;
  font-size: clamp(32px, 5.5vw, 56px);
  font-weight: 900;
  line-height: 1.05;
  letter-spacing: -0.03em;
}
.hero-sub {
  margin-bottom: 28px;
  color: var(--gray3);
  font-size: clamp(13px, 1.8vw, 16px);
  font-weight: 700;
}
.search-wrap {
  position: relative;
  display: block;
  max-width: 480px;
}
.search-input {
  width: 100%;
  padding: 14px 78px 14px 20px;
  border: 2px solid var(--gray1);
  border-radius: 999px;
  outline: 0;
  background: var(--white);
  box-shadow: 0 4px 20px rgb(44 31 20 / 6%);
  color: var(--black);
  font-family: inherit;
  font-size: 14px;
  font-weight: 700;
}
.search-input:focus {
  border-color: var(--black);
  box-shadow: 0 4px 24px rgb(44 31 20 / 10%);
}
.search-clear {
  position: absolute;
  top: 50%;
  right: 44px;
  display: flex;
  width: 20px;
  height: 20px;
  align-items: center;
  justify-content: center;
  transform: translateY(-50%);
  border-radius: 50% !important;
  background: var(--gray2) !important;
  color: #fff !important;
  font-size: 11px !important;
}
.search-icon {
  position: absolute;
  top: 50%;
  right: 16px;
  transform: translateY(-50%);
  pointer-events: none;
}
.breadcrumb {
  display: flex;
  max-width: 1200px;
  align-items: center;
  gap: 6px;
  padding: 14px var(--pad-mob);
  margin: 0 auto;
  color: var(--gray3);
  font-size: 12px;
  font-weight: 700;
}
.breadcrumb-cur {
  color: var(--black);
  font-weight: 800;
}
.breadcrumb-sep {
  color: var(--gray2);
}
.faq-layout {
  display: flex;
  max-width: 1200px;
  align-items: flex-start;
  gap: 24px;
  padding: 0 var(--pad-mob) 80px;
  margin: 0 auto;
}
.faq-sidebar {
  display: none;
  width: var(--sidebar-w);
  flex-shrink: 0;
}
.cat-nav {
  padding: 8px;
  border: 1.5px solid var(--gray1);
  border-radius: 20px;
  background: #fff;
}
.cat-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 12px !important;
  color: var(--gray3) !important;
  font-size: 13px !important;
  font-weight: 800 !important;
  text-align: left;
}
.cat-item.active {
  background: #fce2b3 !important;
  color: var(--black) !important;
}
.cat-icon {
  width: 20px;
  text-align: center;
}
.cat-count {
  margin-left: auto;
  color: var(--gray2);
  font-size: 11px;
}
.sidebar-contact {
  position: relative;
  padding: 24px 20px 0;
  overflow: hidden;
  border: 1.5px solid var(--gray1);
  border-radius: 20px;
  background: #fff8ed;
}
.sc-title {
  margin-bottom: 6px;
  font-size: 15px;
  font-weight: 900;
}
.sc-sub {
  margin-bottom: 16px;
  color: var(--gray3);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.7;
}
.sc-btn {
  display: inline-flex;
  padding: 9px 16px;
  border-radius: 999px;
  background: var(--black);
  color: #fff !important;
  font-size: 12px;
  font-weight: 800;
}
.bear-wrap {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}
.bear-svg {
  width: 88px;
  height: 88px;
}
.faq-content {
  min-width: 0;
  flex: 1;
}
.cat-tabs {
  display: flex;
  gap: 8px;
  padding: 4px 0 16px;
  overflow-x: auto;
}
.cat-tabs button {
  flex-shrink: 0;
  padding: 9px 16px;
  border: 1.5px solid var(--gray1);
  border-radius: 999px;
  background: #fff;
  color: var(--gray3);
  font-size: 12px;
  font-weight: 800;
}
.cat-tabs button.active {
  border-color: var(--black);
  background: var(--black);
  color: #fff;
}
.content-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 0;
  border-bottom: 2px solid var(--black);
}
.content-title {
  font-size: 22px;
  font-weight: 900;
}
.content-count {
  color: var(--gray3);
  font-size: 12px;
  font-weight: 700;
}
.content-sort {
  padding: 7px 12px !important;
  margin-left: auto;
  border: 1px solid var(--gray1) !important;
  border-radius: 999px !important;
  color: var(--gray3) !important;
  font-size: 11px !important;
  font-weight: 800 !important;
}
.search-hint {
  padding: 14px 2px 0;
  color: var(--gray3);
  font-size: 12px;
  font-weight: 700;
}
.faq-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 20px;
}
.faq-item {
  overflow: hidden;
  border: 1.5px solid var(--gray1);
  border-radius: 18px;
  background: #fff;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}
.faq-item.open {
  border-color: var(--gray2);
  box-shadow: 0 8px 28px rgb(44 31 20 / 7%);
}
.faq-q {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 14px;
  padding: 20px;
  text-align: left;
}
.faq-q-icon {
  display: flex;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: #fce2b3;
  color: var(--black);
  font-size: 13px;
  font-weight: 900;
}
.faq-q-text {
  flex: 1;
  font-size: 14px;
  font-weight: 800;
  line-height: 1.5;
}
.faq-q-arrow {
  color: var(--gray2);
  font-size: 15px;
  transition: transform 0.25s;
}
.faq-item.open .faq-q-arrow {
  transform: rotate(180deg);
}
.faq-a {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.3s;
}
.faq-item.open .faq-a {
  max-height: 400px;
}
.faq-a-inner {
  padding: 0 20px 22px 66px;
  color: var(--gray3);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.9;
}
.no-results {
  padding: 72px 20px;
  text-align: center;
}
.nr-icon {
  margin-bottom: 12px;
  font-size: 36px;
}
.nr-title {
  margin-bottom: 6px;
  font-size: 18px;
  font-weight: 900;
}
.nr-sub {
  color: var(--gray3);
  font-size: 13px;
}
.nr-sub a {
  color: var(--accent-o);
  font-weight: 900;
}
.content-cta {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 18px;
  padding: 28px;
  margin-top: 28px;
  border-radius: 22px;
  background: var(--black);
  color: #fff;
}
.cta-title {
  margin-bottom: 6px;
  font-size: 18px;
  font-weight: 900;
}
.cta-sub {
  color: rgb(255 255 255 / 48%);
  font-size: 12px;
  font-weight: 700;
}
.cta-btn {
  padding: 11px 18px;
  border-radius: 999px;
  background: var(--accent-y);
  color: var(--black) !important;
  font-size: 12px;
  font-weight: 900;
}
footer {
  padding: 56px var(--pad-mob) 28px;
  background: var(--black);
  color: rgb(255 255 255 / 42%);
}
.foot-grid {
  display: grid;
  max-width: 1200px;
  grid-template-columns: 1fr 1fr;
  gap: 32px;
  margin: 0 auto;
}
.foot-brand {
  grid-column: 1/-1;
}
.foot-logo {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  color: #fff;
  font-size: 20px;
  font-weight: 900;
}
.foot-desc {
  max-width: 320px;
  color: rgb(255 255 255 / 38%);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.8;
}
.foot-col-title {
  margin-bottom: 14px;
  color: #fff;
  font-size: 13px;
  font-weight: 900;
}
.foot-col-links {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.foot-col-links a {
  font-size: 12px;
  font-weight: 700;
}
.foot-bottom {
  display: flex;
  max-width: 1200px;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 12px;
  padding-top: 24px;
  margin: 36px auto 0;
  border-top: 1px solid rgb(255 255 255 / 9%);
  font-size: 11px;
}
.foot-bottom div {
  display: flex;
  gap: 18px;
}
@media (min-width: 768px) {
  .faq-hero {
    height: 340px;
  }
  .faq-sidebar {
    position: sticky;
    top: calc(var(--nav-h) + 20px);
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .cat-tabs {
    display: none;
  }
  .content-cta {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
  .foot-grid {
    grid-template-columns: 1.5fr repeat(3, 1fr);
  }
  .foot-brand {
    grid-column: auto;
  }
}
@media (min-width: 1024px) {
  .faq-hero {
    height: 380px;
  }
  .hero-inner {
    padding: 48px var(--pad-desk);
  }
  .breadcrumb {
    padding: 14px var(--pad-desk);
  }
  .faq-layout {
    gap: 32px;
    padding: 0 var(--pad-desk) 100px;
  }
  footer {
    padding: 64px var(--pad-desk) 28px;
  }
}
</style>
