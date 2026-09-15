<script setup lang="ts">
/* eslint-disable vue/html-closing-bracket-newline */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { legacyPublicUrl } from '@/config/public-links'

const cursorDot = ref<HTMLElement | null>(null)
const cursorRing = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null
let animationFrame = 0
let cleanupCursor: (() => void) | null = null

onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        entry.target.classList.add('on')
        observer?.unobserve(entry.target)
      })
    },
    { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
  )
  document
    .querySelectorAll('.about-fidelity-page .reveal')
    .forEach((element) => observer?.observe(element))

  if (!window.matchMedia('(pointer:fine)').matches || !cursorDot.value || !cursorRing.value) return
  let mouseX = 0
  let mouseY = 0
  let ringX = 0
  let ringY = 0
  const move = (event: MouseEvent) => {
    mouseX = event.clientX
    mouseY = event.clientY
    if (cursorDot.value) {
      cursorDot.value.style.left = `${mouseX}px`
      cursorDot.value.style.top = `${mouseY}px`
    }
  }
  const hover = (event: MouseEvent) => {
    const target = event.target as Element | null
    const active = Boolean(target?.closest('a, button, .now-card, .belief-card'))
    if (!cursorRing.value) return
    cursorRing.value.classList.toggle('is-active', active)
  }
  const tick = () => {
    ringX += (mouseX - ringX) * 0.12
    ringY += (mouseY - ringY) * 0.12
    if (cursorRing.value) {
      cursorRing.value.style.left = `${ringX}px`
      cursorRing.value.style.top = `${ringY}px`
    }
    animationFrame = window.requestAnimationFrame(tick)
  }
  document.addEventListener('mousemove', move)
  document.addEventListener('mouseover', hover)
  animationFrame = window.requestAnimationFrame(tick)
  cleanupCursor = () => {
    document.removeEventListener('mousemove', move)
    document.removeEventListener('mouseover', hover)
  }
})

onBeforeUnmount(() => {
  observer?.disconnect()
  cleanupCursor?.()
  window.cancelAnimationFrame(animationFrame)
})
</script>

<template>
  <main class="about-fidelity-page">
    <div ref="cursorDot" class="about-cursor-dot" />
    <div ref="cursorRing" class="about-cursor-ring" />

    <section id="hero">
      <div class="hero-blob hero-blob-1" />
      <div class="hero-blob hero-blob-2" />
      <div class="hero-bg-num">哞</div>
      <div class="hero-inner">
        <p class="hero-eyebrow">关于哞屋 · ABOUT MOWO</p>
        <h1 class="hero-statement">
          让每一帧热爱，<br />不只停留在<span class="hl">屏幕里</span>。
        </h1>
        <p class="hero-desc">
          哞屋关注逐帧动画与实体文创之间的可能：让连续画面成为可以转动、触摸、陈列和分享的作品。
        </p>
      </div>
    </section>

    <section id="story">
      <div class="story-header reveal">
        <p class="sec-eyebrow">我们正在做的事</p>
        <h2 class="sec-title">从连续画面，<br />到一件真实作品</h2>
      </div>
      <div class="timeline">
        <article class="tl-item reveal">
          <div class="tl-dot-wrap"><div class="tl-dot">✏️</div></div>
          <div class="tl-body">
            <p class="tl-time">画面</p>
            <h3 class="tl-title">故事从一帧一帧开始</h3>
            <p class="tl-desc">
              动画由连续画面组成。每一帧都可以保留创作者的笔触，也可以来自用户自己的视频与图片。
            </p>
          </div>
        </article>
        <article class="tl-item reveal">
          <div class="tl-dot-wrap"><div class="tl-dot">✨</div></div>
          <div class="tl-body">
            <p class="tl-time">转动</p>
            <h3 class="tl-title">让画面离开屏幕</h3>
            <p class="tl-desc">
              把连续画面装进机械动画机，通过手柄控制播放节奏，让观看重新拥有触感和参与感。
            </p>
            <div class="tl-quote"><p>每一次转动，都是一次创意的呈现。</p></div>
          </div>
        </article>
        <article class="tl-item reveal">
          <div class="tl-dot-wrap"><div class="tl-dot tl-dot-small">🧩</div></div>
          <div class="tl-body">
            <p class="tl-time">制作</p>
            <h3 class="tl-title">把创意接入可靠的生产流程</h3>
            <p class="tl-desc">
              从最终帧图、商品规格到库存、生产任务和装箱，逐步建立可以核验和追溯的履约关系。
            </p>
            <div class="tl-hardship">
              <p>
                尚未验证的能力不会被包装成承诺；作品、规格和交付信息以工作人员确认及服务端记录为准。
              </p>
            </div>
          </div>
        </article>
        <article class="tl-item reveal">
          <div class="tl-dot-wrap"><div class="tl-dot tl-dot-small">🏠</div></div>
          <div class="tl-body">
            <p class="tl-time">现在</p>
            <h3 class="tl-title">两条清晰的创作路径</h3>
            <p class="tl-desc">
              联名商品由工作人员核验权利和生产条件后上架；私人定制让用户把自己的视频或图片制作成专属动画。
            </p>
            <div class="tl-quote"><p>认真对待每一份作品，也认真对待每一次交付。</p></div>
          </div>
        </article>
      </div>
    </section>

    <section id="beliefs">
      <div class="beliefs-header">
        <p class="sec-eyebrow reveal">我们相信</p>
        <h2 class="sec-title reveal d1">三件持续<br />坚持的事</h2>
      </div>
      <div class="beliefs-grid">
        <article class="belief-card reveal">
          <div class="belief-num">01</div>
          <h3 class="belief-title">尊重作品权利</h3>
          <p class="belief-desc">合作之前先确认授权与用途，不让公开展示变成任意复制的许可。</p>
        </article>
        <article class="belief-card reveal d1">
          <div class="belief-num">02</div>
          <h3 class="belief-title">认真对待制造</h3>
          <p class="belief-desc">从最终帧图、商品规格到单件生产和装箱，建立可追溯的履约关系。</p>
        </article>
        <article class="belief-card reveal d2">
          <div class="belief-num">03</div>
          <h3 class="belief-title">诚实表达进度</h3>
          <p class="belief-desc">尚未验证的配送、支付、售后和平台能力，不写成已经兑现的承诺。</p>
        </article>
      </div>
    </section>

    <section id="now">
      <div class="now-inner">
        <div class="now-text reveal">
          <p class="sec-eyebrow">现在的哞屋</p>
          <h2 class="sec-title now-title">还在路上，<br />但方向很清楚</h2>
          <p>
            我们正在把联名商品、私人定制、订单、库存和生产履约连接成清晰、可靠、便于维护的完整流程。
          </p>
          <p>
            合作作品由工作人员人工核验权利、生产效果和合作条件。如果你认同实体动画的价值，欢迎把作品或合作想法告诉我们。
          </p>
          <a :href="legacyPublicUrl('contact')" class="btn btn-black btn-fit">联络我们 →</a>
        </div>
        <div class="now-cards reveal d1">
          <article class="now-card">
            <div class="now-card-icon">🎨</div>
            <div>
              <p class="now-card-title">联名商品</p>
              <p class="now-card-desc">合作方提供经确认的动画内容，哞屋完成商品配置后正式上架。</p>
            </div>
          </article>
          <article class="now-card">
            <div class="now-card-icon">🎁</div>
            <div>
              <p class="now-card-title">私人定制</p>
              <p class="now-card-desc">用户可以使用自己的视频或图片，制作专属的实体动画作品。</p>
            </div>
          </article>
          <article class="now-card">
            <div class="now-card-icon">📦</div>
            <div>
              <p class="now-card-title">生产履约</p>
              <p class="now-card-desc">
                库存、生产任务和订单状态以服务端事实为准，逐步形成可追溯链路。
              </p>
            </div>
          </article>
        </div>
      </div>
    </section>

    <section id="cta-final">
      <p class="cta-eyebrow reveal">与我们合作</p>
      <h2 class="cta-title reveal d1">有作品或合作想法？</h2>
      <p class="cta-desc reveal d2">当前由工作人员人工沟通并确认作品权利、合作条件和生产可行性。</p>
      <div class="cta-btns reveal d3">
        <a :href="legacyPublicUrl('contact')" class="btn btn-yellow">提交合作意向 →</a
        ><a :href="legacyPublicUrl('contact')" class="btn btn-black">联络我们</a
        ><RouterLink to="/products" class="btn btn-ghost">查看产品</RouterLink>
      </div>
    </section>

    <footer>
      <div class="foot-row">
        <RouterLink to="/" class="foot-logo">哞屋 MOWO</RouterLink>
        <div class="foot-links">
          <RouterLink to="/about">关于我们</RouterLink
          ><RouterLink to="/products">产品介绍</RouterLink
          ><RouterLink to="/showcase">联名商品</RouterLink
          ><a :href="legacyPublicUrl('customize-start')">私人定制</a
          ><a :href="legacyPublicUrl('contact')">联络我们</a>
        </div>
      </div>
      <p class="foot-copy">© {{ new Date().getFullYear() }} 哞屋 MOWO. All rights reserved.</p>
    </footer>
  </main>
</template>

<style scoped>
.about-fidelity-page {
  --cream: #fef3e2;
  --black: #2c1f14;
  --gray1: #e8d8be;
  --gray2: #c0aa88;
  --gray3: #7a6552;
  --accent-y: #f0c040;
  --accent-o: #e8662a;
  --ease: cubic-bezier(0.22, 1, 0.36, 1);
  --pad-mob: 24px;
  --pad-desk: 72px;
  overflow: hidden;
  background: var(--cream);
  color: var(--black);
  font-family: Nunito, 'Noto Sans SC', sans-serif;
  -webkit-font-smoothing: antialiased;
}
.about-fidelity-page * {
  box-sizing: border-box;
}
.about-fidelity-page :is(h1, h2, h3, p) {
  margin: 0;
}
.about-fidelity-page a {
  color: inherit;
  text-decoration: none;
}
#hero {
  position: relative;
  display: flex;
  min-height: calc(100vh - var(--nav-h));
  align-items: center;
  padding: 80px var(--pad-mob);
  overflow: hidden;
  background: var(--cream);
}
.hero-blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(60px);
  pointer-events: none;
}
.hero-blob-1 {
  top: -10%;
  right: -10%;
  width: min(500px, 100vw);
  height: min(500px, 100vw);
  animation: blob-float 8s ease-in-out infinite;
  background: var(--accent-y);
  opacity: 0.22;
}
.hero-blob-2 {
  bottom: 5%;
  left: -5%;
  width: min(300px, 70vw);
  height: min(300px, 70vw);
  animation: blob-float 10s ease-in-out 2s infinite reverse;
  background: #c8965a;
  opacity: 0.12;
}
@keyframes blob-float {
  50% {
    transform: translate(20px, -20px) scale(1.05);
  }
}
.hero-bg-num {
  position: absolute;
  right: -20px;
  bottom: -60px;
  color: rgb(0 0 0 / 4%);
  font-size: min(400px, 60vw);
  font-weight: 900;
  line-height: 1;
  letter-spacing: -0.06em;
  pointer-events: none;
  user-select: none;
}
.hero-inner {
  position: relative;
  z-index: 2;
  max-width: 900px;
}
.hero-eyebrow,
.sec-eyebrow,
.cta-eyebrow {
  margin-bottom: 28px;
  color: var(--gray3);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.25em;
  text-transform: uppercase;
}
.hero-eyebrow {
  animation: fup 0.8s var(--ease) 0.2s forwards;
  opacity: 0;
}
.hero-statement {
  margin-bottom: 36px;
  animation: fup 0.9s var(--ease) 0.4s forwards;
  color: var(--black);
  font-size: clamp(38px, 7.5vw, 88px);
  font-weight: 900;
  line-height: 1.08;
  letter-spacing: -0.03em;
  opacity: 0;
}
.hero-statement .hl {
  position: relative;
  z-index: 1;
  display: inline-block;
}
.hero-statement .hl::after {
  position: absolute;
  z-index: -1;
  right: -4px;
  bottom: 4px;
  left: -4px;
  height: 14px;
  border-radius: 4px;
  background: #fce2b3;
  content: '';
}
.hero-desc {
  max-width: 560px;
  animation: fup 0.9s var(--ease) 0.65s forwards;
  color: var(--gray3);
  font-size: clamp(15px, 2vw, 19px);
  font-weight: 700;
  line-height: 1.9;
  opacity: 0;
}
@keyframes fup {
  to {
    transform: none;
    opacity: 1;
  }
}
#story,
#now {
  padding: 120px var(--pad-mob);
  background: #fffaf4;
}
.story-header {
  margin-bottom: 80px;
}
.sec-eyebrow {
  margin-bottom: 16px;
}
.sec-title {
  color: var(--black);
  font-size: clamp(30px, 6vw, 60px);
  font-weight: 900;
  line-height: 1.1;
  letter-spacing: -0.02em;
}
.timeline {
  position: relative;
  max-width: 800px;
}
.timeline::before {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 19px;
  width: 2px;
  border-radius: 2px;
  background: linear-gradient(to bottom, var(--gray1), var(--gray2), var(--gray1));
  content: '';
}
.tl-item {
  position: relative;
  display: flex;
  gap: 28px;
  margin-bottom: 64px;
}
.tl-item:last-child {
  margin-bottom: 0;
}
.tl-dot-wrap {
  position: relative;
  z-index: 1;
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  align-items: center;
}
.tl-dot {
  display: flex;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--gray1);
  border-radius: 50%;
  background: var(--cream);
  font-size: 18px;
  transition: transform 0.3s var(--ease);
}
.tl-item:hover .tl-dot {
  transform: scale(1.15);
}
.tl-item:nth-child(2) .tl-dot {
  border-color: #c8965a;
  background: #fce2b3;
}
.tl-item:nth-child(3) .tl-dot {
  border-color: #3a2e28;
  background: #2c1f14;
}
.tl-item:nth-child(4) .tl-dot {
  border-color: var(--black);
  background: var(--black);
}
.tl-dot-small {
  font-size: 14px;
}
.tl-body {
  padding-top: 8px;
}
.tl-time {
  margin-bottom: 10px;
  color: var(--gray3);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}
.tl-title {
  margin-bottom: 12px;
  color: var(--black);
  font-size: clamp(20px, 3vw, 26px);
  font-weight: 900;
  line-height: 1.2;
}
.tl-desc {
  max-width: 580px;
  color: var(--gray3);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.9;
}
.tl-quote,
.tl-hardship {
  max-width: 520px;
  padding: 20px 24px;
  margin-top: 20px;
  border-left: 4px solid #c8965a;
  border-radius: 16px;
  background: #fff8ed;
}
.tl-quote p {
  color: var(--black);
  font-size: 15px;
  font-style: italic;
  font-weight: 800;
  line-height: 1.8;
}
.tl-hardship {
  border-left-color: var(--accent-o);
  background: #fff3ec;
}
.tl-hardship p {
  color: #6b3a20;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.85;
}
#beliefs {
  padding: 120px var(--pad-mob);
  background: var(--cream);
}
.beliefs-header {
  margin-bottom: 72px;
  text-align: center;
}
.beliefs-grid {
  display: grid;
  max-width: 1100px;
  grid-template-columns: 1fr;
  gap: 16px;
  margin: 0 auto;
}
.belief-card {
  position: relative;
  padding: 40px 32px;
  overflow: hidden;
  border: 2px solid transparent;
  border-radius: 28px;
  transition:
    transform 0.3s var(--ease),
    box-shadow 0.3s;
}
.belief-card:hover {
  transform: translateY(-6px);
  box-shadow: 0 20px 48px rgb(0 0 0 / 10%);
}
.belief-card:nth-child(1) {
  border-color: #e8c87a;
  background: #fff8ed;
}
.belief-card:nth-child(2) {
  border-color: #e8a880;
  background: #fff3ec;
}
.belief-card:nth-child(3) {
  border-color: #d4a843;
  background: #fef5e4;
}
.belief-num {
  margin-bottom: 20px;
  color: rgb(180 130 20 / 20%);
  font-size: 52px;
  font-weight: 900;
  line-height: 1;
  letter-spacing: -0.04em;
}
.belief-title {
  margin-bottom: 14px;
  color: var(--black);
  font-size: clamp(17px, 2.5vw, 21px);
  font-weight: 900;
  line-height: 1.3;
}
.belief-desc {
  color: var(--gray3);
  font-size: 14px;
  font-weight: 700;
  line-height: 1.9;
}
.now-inner {
  display: grid;
  max-width: 1100px;
  grid-template-columns: 1fr;
  align-items: center;
  gap: 64px;
}
.now-title {
  margin-bottom: 28px;
}
.now-text > p {
  margin-bottom: 16px;
  color: var(--gray3);
  font-size: clamp(15px, 2vw, 17px);
  font-weight: 700;
  line-height: 1.95;
}
.now-text > p:last-of-type {
  margin-bottom: 32px;
}
.now-cards {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.now-card {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 24px 28px;
  border: 2px solid var(--gray1);
  border-radius: 20px;
  background: #fff8ed;
  transition:
    transform 0.3s var(--ease),
    box-shadow 0.3s;
}
.now-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 36px rgb(44 31 20 / 8%);
}
.now-card-icon {
  display: flex;
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 1px solid #e8c87a;
  border-radius: 12px;
  background: #fce2b3;
  font-size: 28px;
}
.now-card-title {
  margin-bottom: 4px;
  color: var(--black);
  font-size: 15px;
  font-weight: 900;
}
.now-card-desc {
  color: var(--gray3);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.7;
}
#cta-final {
  padding: 120px var(--pad-mob);
  border-top: 1px solid var(--gray1);
  background: var(--cream);
  text-align: center;
}
.cta-eyebrow {
  margin-bottom: 20px;
}
.cta-title {
  margin-bottom: 20px;
  color: var(--black);
  font-size: clamp(28px, 6vw, 60px);
  font-weight: 900;
  line-height: 1.1;
}
.cta-desc {
  max-width: 480px;
  margin: 0 auto 48px;
  color: var(--gray3);
  font-size: clamp(15px, 2vw, 18px);
  font-weight: 700;
  line-height: 1.8;
}
.cta-btns {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 14px;
}
.btn {
  display: inline-flex;
  min-height: 56px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px 32px;
  border: 0;
  border-radius: 999px;
  font-size: 15px;
  font-weight: 800;
  transition:
    transform 0.2s,
    box-shadow 0.2s;
}
.btn-black {
  background: var(--black);
  color: #fff;
  box-shadow: 0 4px 0 rgb(0 0 0 / 20%);
}
.btn-yellow {
  background: #fce2b3;
  color: var(--black);
  box-shadow: 0 4px 0 #c8965a;
}
.btn-ghost {
  border: 2px solid var(--gray1);
  background: transparent;
  color: var(--gray3);
}
.btn:hover {
  transform: translateY(-2px);
}
.btn-fit {
  width: fit-content;
}
footer {
  padding: 48px var(--pad-mob) 36px;
  background: var(--black);
  color: rgb(255 255 255 / 40%);
}
.foot-row {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.foot-logo {
  color: #fff;
  font-size: 20px;
  font-weight: 900;
}
.foot-links {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
}
.foot-links a {
  color: rgb(255 255 255 / 35%);
  font-size: 13px;
  font-weight: 700;
}
.foot-links a:hover {
  color: #fff;
}
.foot-copy {
  margin-top: 24px;
  color: rgb(255 255 255 / 18%);
  font-size: 12px;
  font-weight: 700;
}
.reveal {
  transform: translateY(28px);
  opacity: 0;
  transition:
    opacity 0.75s var(--ease),
    transform 0.75s var(--ease);
}
.reveal.on {
  transform: none;
  opacity: 1;
}
.d1 {
  transition-delay: 0.1s;
}
.d2 {
  transition-delay: 0.2s;
}
.d3 {
  transition-delay: 0.3s;
}
@media (pointer: fine) {
  .about-fidelity-page,
  .about-fidelity-page a {
    cursor: none;
  }
  .about-cursor-dot,
  .about-cursor-ring {
    position: fixed;
    z-index: 9999;
    width: 8px;
    height: 8px;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    background: #111;
    pointer-events: none;
  }
  .about-cursor-ring {
    width: 32px;
    height: 32px;
    border: 1.5px solid rgb(17 17 16 / 30%);
    background: transparent;
    transition:
      width 0.3s,
      height 0.3s,
      opacity 0.3s;
  }
  .about-cursor-ring.is-active {
    width: 52px;
    height: 52px;
    opacity: 0.4;
  }
}
@media (min-width: 640px) {
  .timeline::before {
    left: 23px;
  }
  .beliefs-grid {
    grid-template-columns: repeat(3, 1fr);
  }
  .foot-row {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
}
@media (min-width: 1024px) {
  #hero {
    padding: 80px var(--pad-desk);
  }
  #story,
  #beliefs,
  #now,
  #cta-final {
    padding: 140px var(--pad-desk);
  }
  .now-inner {
    grid-template-columns: 1fr 1fr;
    gap: 100px;
  }
  footer {
    padding: 48px var(--pad-desk) 36px;
  }
}
</style>
