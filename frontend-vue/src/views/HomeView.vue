<script setup lang="ts">
/* eslint-disable vue/html-closing-bracket-newline, vue/html-indent */
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import heroImageUrl from '../../../frontend/assets/hero-main.png'
import boxDiagramUrl from '../../../frontend/assets/box-diagram.png'
import { legacyPublicUrl } from '@/config/public-links'
import { getCollabWorks } from '@/features/collab/api'
import type { CollabWorkSummary } from '@/features/collab/types'

const works = ref<CollabWorkSummary[]>([])
const diagramFailed = ref(false)
const cursorDot = ref<HTMLElement | null>(null)
const cursorRing = ref<HTMLElement | null>(null)

let observer: IntersectionObserver | null = null
let animationFrame = 0
let removePointerListener: (() => void) | null = null

function observeRevealElements(): void {
  document
    .querySelectorAll('.home-fidelity-page .reveal:not(.in)')
    .forEach((element) => observer?.observe(element))
}

function mediaFailed(event: Event): void {
  const image = event.currentTarget as HTMLImageElement
  image.hidden = true
  image.nextElementSibling?.removeAttribute('hidden')
}

onMounted(async () => {
  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        entry.target.classList.add('in')
        observer?.unobserve(entry.target)
      })
    },
    { threshold: 0.1 }
  )
  observeRevealElements()

  if (window.matchMedia('(pointer:fine)').matches && cursorDot.value && cursorRing.value) {
    let mouseX = 0
    let mouseY = 0
    let ringX = 0
    let ringY = 0
    const move = (event: MouseEvent) => {
      mouseX = event.clientX
      mouseY = event.clientY
      if (cursorDot.value) {
        cursorDot.value.style.transform = `translate(${mouseX}px,${mouseY}px) translate(-50%,-50%)`
      }
    }
    const follow = () => {
      ringX += (mouseX - ringX) * 0.16
      ringY += (mouseY - ringY) * 0.16
      if (cursorRing.value) {
        cursorRing.value.style.transform = `translate(${ringX}px,${ringY}px) translate(-50%,-50%)`
      }
      animationFrame = window.requestAnimationFrame(follow)
    }
    document.addEventListener('mousemove', move)
    removePointerListener = () => document.removeEventListener('mousemove', move)
    animationFrame = window.requestAnimationFrame(follow)
  }

  try {
    works.value = (await getCollabWorks({ page: 1, limit: 4, sort: 'recommended' })).works.slice(
      0,
      4
    )
  } catch {
    works.value = []
  }
  await nextTick()
  observeRevealElements()
})

onBeforeUnmount(() => {
  observer?.disconnect()
  removePointerListener?.()
  window.cancelAnimationFrame(animationFrame)
})
</script>

<template>
  <main class="home-fidelity-page">
    <div ref="cursorDot" class="cursor-dot" />
    <div ref="cursorRing" class="cursor-ring" />

    <section class="hero">
      <div class="hero-bg"><img :src="heroImageUrl" alt="哞屋动盒产品图" /></div>
      <div class="hero-overlay" />
      <div class="hero-text reveal">
        <h1>转动手柄<br />让创意动起来</h1>
        <div class="hero-sub">动盒 · 手摇动画机</div>
        <RouterLink to="/showcase" class="hero-cta">
          探索动盒
          <svg viewBox="0 0 24 24"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
        </RouterLink>
      </div>
    </section>

    <section class="features">
      <div class="container">
        <div class="features-grid">
          <div class="feature-item reveal">
            <div class="feature-icon">
              <svg viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="3" />
                <path
                  d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.18V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0-1.18-2.82H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68V4a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 2.82 1.18l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 2z"
                />
              </svg>
            </div>
            <div>
              <h4>经典机械原理</h4>
              <p>无需电子，纯机械驱动</p>
            </div>
          </div>
          <div class="feature-item reveal">
            <div class="feature-icon">
              <svg viewBox="0 0 24 24">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <div>
              <h4>激发创造力</h4>
              <p>一张张画，变成生动故事</p>
            </div>
          </div>
          <div class="feature-item reveal">
            <div class="feature-icon">
              <svg viewBox="0 0 24 24">
                <path
                  d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"
                />
                <path d="m3.27 6.96 8.73 5.05 8.73-5.05M12 22.08V12" />
              </svg>
            </div>
            <div>
              <h4>实体留存</h4>
              <p>可以触摸、陈列和赠送</p>
            </div>
          </div>
          <div class="feature-item reveal">
            <div class="feature-icon">
              <svg viewBox="0 0 24 24">
                <path d="M12 2 2 7l10 5 10-5z" />
                <path d="m2 17 10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </div>
            <div>
              <h4>动手又好玩</h4>
              <p>亲手制作，保留创作乐趣</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section>
      <div class="container">
        <div class="sec-head reveal">
          <h2 class="sec-title">从这里开始</h2>
          <RouterLink to="/products" class="sec-link">
            了解产品 <svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" /></svg>
          </RouterLink>
        </div>
        <div class="styles-grid">
          <RouterLink to="/showcase" class="style-card reveal">
            <div class="style-img">📦</div>
            <div class="style-body">
              <div class="style-name">联名商品</div>
              <div class="style-meta">浏览已核验并正式上架的作品</div>
              <span class="style-more"
                >查看商品 <svg viewBox="0 0 24 24"><path d="M5 12h14M13 5l7 7-7 7" /></svg
              ></span>
            </div>
          </RouterLink>
          <a :href="legacyPublicUrl('customize-start')" class="style-card reveal"
            ><div class="style-img style-img--gift">🎁</div>
            <div class="style-body">
              <div class="style-name">私人定制</div>
              <div class="style-meta">用自己的视频或图片制作专属动画</div>
              <span class="style-more"
                >开始制作 <svg viewBox="0 0 24 24"><path d="M5 12h14M13 5l7 7-7 7" /></svg
              ></span></div
          ></a>
          <RouterLink to="/products" class="style-card reveal">
            <div class="style-img style-img--dark">📽️</div>
            <div class="style-body">
              <div class="style-name">产品介绍</div>
              <div class="style-meta">了解逐帧动画原理与观看方式</div>
              <span class="style-more"
                >了解更多 <svg viewBox="0 0 24 24"><path d="M5 12h14M13 5l7 7-7 7" /></svg
              ></span>
            </div>
          </RouterLink>
          <RouterLink to="/about" class="style-card reveal">
            <div class="style-img style-img--tool">🛠️</div>
            <div class="style-body">
              <div class="style-name">哞屋造物</div>
              <div class="style-meta">认识品牌和我们正在做的事</div>
              <span class="style-more"
                >品牌故事 <svg viewBox="0 0 24 24"><path d="M5 12h14M13 5l7 7-7 7" /></svg
              ></span>
            </div>
          </RouterLink>
        </div>
      </div>
    </section>

    <section>
      <div class="container">
        <div class="what-box reveal">
          <div>
            <h2>什么是动盒？</h2>
            <p>动盒是一款通过手摇驱动，让一张张画面动起来的机械动画机。</p>
            <p>灵感来自经典的翻页动画原理，每一次转动，都是一次创意的呈现。</p>
            <RouterLink to="/products" class="more-btn">
              了解更多 <svg viewBox="0 0 24 24"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
            </RouterLink>
          </div>
          <div class="diagram-wrap">
            <img
              v-if="!diagramFailed"
              :src="boxDiagramUrl"
              alt="动盒结构线稿"
              @error="diagramFailed = true"
            />
            <div v-else class="diagram-placeholder">
              <svg viewBox="0 0 24 24">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 16l5-5 4 4 5-5 4 4M9 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" /></svg
              ><strong>产品线稿暂时不可用</strong>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section>
      <div class="container">
        <div class="sec-head reveal">
          <h2 class="sec-title">联名作品</h2>
          <RouterLink to="/showcase" class="sec-link">
            探索更多 <svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" /></svg>
          </RouterLink>
        </div>
        <div v-if="works.length" class="creative-grid">
          <RouterLink
            v-for="work in works"
            :key="work.id"
            :to="`/showcase/${work.id}`"
            class="creative-card reveal"
          >
            <div class="creative-thumb">
              <img
                v-if="work.coverUrl"
                :src="work.coverUrl"
                :alt="work.title"
                @error="mediaFailed"
              /><span :hidden="Boolean(work.coverUrl)" class="creative-placeholder">M</span>
            </div>
            <div class="creative-meta">
              <strong>{{ work.title }}</strong
              ><span>@{{ work.creator.nickname }}</span>
            </div>
          </RouterLink>
        </div>
        <p v-else class="creative-empty reveal">联名作品正在准备中，稍后再来看看。</p>
      </div>
    </section>

    <section class="cta-banner">
      <div class="container">
        <h2>准备好创造属于你的动画故事了吗？</h2>
        <a :href="legacyPublicUrl('customize-start')" class="cta-banner-btn"
          >开始你的动盒之旅 <svg viewBox="0 0 24 24"><path d="M5 12h14M13 5l7 7-7 7" /></svg
        ></a>
      </div>
    </section>

    <footer>
      <div class="container footer-row">
        <RouterLink to="/" class="footer-brand">
          <span class="mowo-logo-mark">M</span>MOWOBOX 哞屋造物
        </RouterLink>
        <div class="footer-links">
          <RouterLink to="/about">关于我们</RouterLink>
          <a :href="legacyPublicUrl('contact')">帮助中心</a>
          <RouterLink to="/legal/privacy">隐私政策</RouterLink>
          <RouterLink to="/legal/terms">用户协议</RouterLink>
          <a :href="legacyPublicUrl('contact')">联系我们</a>
        </div>
      </div>
    </footer>
  </main>
</template>
