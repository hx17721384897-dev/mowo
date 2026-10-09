<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

const cursorDot = ref<HTMLElement | null>(null)
const cursorRing = ref<HTMLElement | null>(null)
const activeFrame = ref(0)
let observer: IntersectionObserver | null = null
let frameTimer = 0
let animationFrame = 0
let cleanupCursor: (() => void) | null = null

onMounted(() => {
  observer = new IntersectionObserver(
    (entries) =>
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        entry.target.classList.add('on')
        observer?.unobserve(entry.target)
      }),
    { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
  )
  document
    .querySelectorAll('.product-fidelity-page .reveal')
    .forEach((element) => observer?.observe(element))
  frameTimer = window.setInterval(() => {
    activeFrame.value = (activeFrame.value + 1) % 12
  }, 200)

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
    cursorRing.value?.classList.toggle(
      'is-active',
      Boolean((event.target as Element | null)?.closest('a,button'))
    )
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
  animationFrame = window.requestAnimationFrame(tick)
  cleanupCursor = () => document.removeEventListener('mousemove', move)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  window.clearInterval(frameTimer)
  window.cancelAnimationFrame(animationFrame)
  cleanupCursor?.()
})
</script>

<template>
  <main class="product-fidelity-page">
    <div ref="cursorDot" class="product-cursor-dot" />
    <div ref="cursorRing" class="product-cursor-ring" />

    <section id="hero">
      <div class="hero-bg">
        <div class="hero-bg-placeholder">
          <div class="hero-bg-placeholder-icon">📷</div>
          <div class="hero-bg-placeholder-text">产品实拍 / 渲染大图准备中</div>
        </div>
      </div>
      <div class="hero-overlay" />
      <div class="hero-content">
        <h1 class="hero-product-name">哞屋<br /><span>动画机</span></h1>
        <p class="hero-definition">
          一台可以让动画在现实中播放的装置——转动手柄，连续画面就动了起来。
        </p>
      </div>
      <div class="hero-scroll">
        <span>向下探索</span>
        <div class="hero-scroll-dot" />
      </div>
    </section>

    <div class="principle-strip">
      <div class="principle-inner">
        <div class="principle-text reveal">
          <p class="principle-eyebrow">工作原理</p>
          <h2 class="principle-title">逐帧播放，<br />制造运动的错觉</h2>
          <p class="principle-body">
            当一系列连续的静止画面快速切换时，眼睛会将它们连接成流畅的动画。<br /><br />哞屋动画机把这个原理装进你的手心。转动手柄，画面依次经过视线，动画由你的动作亲手发生。
          </p>
        </div>
        <div class="reveal d1">
          <div class="horse-frames">
            <div
              v-for="index in 12"
              :key="index"
              class="horse-frame"
              :class="{ active: activeFrame === index - 1 }"
            >
              🐎
            </div>
          </div>
          <p class="frames-note">▲ 连续静止画面依次播放，形成运动观感</p>
        </div>
      </div>
    </div>

    <section id="why">
      <div class="why-header reveal">
        <p class="sec-eyebrow">为什么会有这个产品</p>
        <h2 class="sec-title">你的画面，<br />可以动起来</h2>
        <p class="sec-body">
          海报、摆件、徽章和卡牌都能承载创意；动画机提供另一种选择，让静止画面通过亲手转动形成连续故事。
        </p>
      </div>
      <div class="static-row reveal">
        <article
          v-for="item in [
            { icon: '🖼️', name: '海报' },
            { icon: '🗿', name: '摆件' },
            { icon: '📛', name: '徽章' },
            { icon: '🎴', name: '卡牌' },
            { icon: '🧸', name: '玩偶' }
          ]"
          :key="item.name"
          class="static-item-card"
        >
          <div class="static-item-img">
            <div class="static-item-icon">{{ item.icon }}</div>
            <div class="static-item-label-img">静态展示</div>
          </div>
          <div class="static-item-footer">
            <p class="static-item-name">{{ item.name }}</p>
          </div>
        </article>
      </div>
      <div class="why-reveal">
        <div class="why-arrow reveal">
          <div class="why-arrow-line" />
          <div class="why-arrow-tip">↓</div>
        </div>
        <div class="why-answer reveal">
          <div class="why-answer-img">
            <span class="why-answer-tag">✦ 哞屋动画机</span>
            <div class="why-answer-device"><div class="why-answer-ring" /></div>
          </div>
          <div class="why-answer-body">
            <h3 class="why-answer-title">让逐帧画面成为可转动的实体作品</h3>
            <p class="why-answer-desc">
              它不只是展示，也包含转动和观看的过程。创作者或用户提供有权使用的画面，哞屋把它连接到可确认的商品与制作流程。
            </p>
          </div>
        </div>
      </div>
    </section>

    <section id="scenes">
      <div class="scenes-header reveal">
        <p class="sec-eyebrow">你可以用它做什么</p>
        <h2 class="sec-title">不同画面，<br />都有它的玩法</h2>
      </div>
      <div class="scene-row reveal">
        <div class="scene-img">
          <div class="scene-img-placeholder">✏️</div>
          <div class="scene-img-label">原创动画</div>
        </div>
        <div class="scene-text">
          <p class="scene-num">01</p>
          <span class="scene-tag">✦ 原创动画</span>
          <h3 class="scene-title">把你画的动画，<br />做成真实的东西</h3>
          <p class="scene-desc">
            上传自己创作的逐帧画面，筛选合适的帧，再按照正式款式要求确认制作。
          </p>
        </div>
      </div>
      <div class="scene-row reverse reveal">
        <div class="scene-text">
          <p class="scene-num">02</p>
          <span class="scene-tag">✦ 授权内容</span>
          <h3 class="scene-title">让有权使用的角色，<br />在手心里动起来</h3>
          <p class="scene-desc">
            只有在拥有合法权利或明确授权时，才可使用角色、游戏或其他第三方内容制作作品。
          </p>
        </div>
        <div class="scene-img">
          <div class="scene-img-placeholder">⭐</div>
          <div class="scene-img-label">授权内容</div>
        </div>
      </div>
      <div class="scene-row reveal">
        <div class="scene-img">
          <div class="scene-img-placeholder">🎞️</div>
          <div class="scene-img-label">私人影像</div>
        </div>
        <div class="scene-text">
          <p class="scene-num">03</p>
          <span class="scene-tag">✦ 私人定制</span>
          <h3 class="scene-title">从自己的视频或图片，<br />选出连续画面</h3>
          <p class="scene-desc">
            可以自己筛选关键帧，也可以在提交需求后由工作人员协助确认画面处理方式。
          </p>
        </div>
      </div>
      <div class="scene-row reverse reveal">
        <div class="scene-text">
          <p class="scene-num">04</p>
          <span class="scene-tag">✦ 专属礼物</span>
          <h3 class="scene-title">把一段共同记忆，<br />做成可以转动的礼物</h3>
          <p class="scene-desc">
            使用自己拥有权利的影像制作专属内容，最终效果、规格和交付以确认页面为准。
          </p>
        </div>
        <div class="scene-img">
          <div class="scene-img-placeholder">🎁</div>
          <div class="scene-img-label">专属礼物</div>
        </div>
      </div>
      <div class="scene-row reveal">
        <div class="scene-img">
          <div class="scene-img-placeholder">🎨</div>
          <div class="scene-img-label">逐帧学习</div>
        </div>
        <div class="scene-text">
          <p class="scene-num">05</p>
          <span class="scene-tag">✦ 理解动画</span>
          <h3 class="scene-title">亲手排列画面，<br />理解动画怎样发生</h3>
          <p class="scene-desc">从静止帧到连续运动，转动和观察本身就是认识逐帧动画原理的过程。</p>
        </div>
      </div>
      <div class="scene-row reverse scene-row-dark reveal">
        <div class="scene-text">
          <p class="scene-num">06</p>
          <span class="scene-tag">✦ 联名合作</span>
          <h3 class="scene-title">提供你的作品，<br />一起确认如何落地</h3>
          <p class="scene-desc">
            动画创作者可以通过联络页面提交作品和合作意向，由团队人工确认权利、生产效果和合作条件。
          </p>
          <RouterLink to="/contact" class="btn btn-yellow scene-action">了解合作方式 →</RouterLink>
        </div>
        <div class="scene-img">
          <div class="scene-img-placeholder">🌟</div>
          <div class="scene-img-label">联名合作</div>
        </div>
      </div>
    </section>

    <section id="product-boundary">
      <div class="boundary-inner reveal">
        <p class="sec-eyebrow">产品信息</p>
        <h2 class="sec-title">规格与价格，<br />只使用正式数据</h2>
        <p class="boundary-body">
          本页不展示未经确认的材质、颜色、帧数、价格或交期。联名商品以商品详情返回的可售规格为准；私人定制以款式确认页面和工作人员最终确认为准。
        </p>
        <div class="boundary-actions">
          <RouterLink to="/showcase" class="btn btn-dark">查看联名商品</RouterLink
          ><RouterLink to="/customize" class="btn btn-outline">开始私人定制</RouterLink>
        </div>
      </div>
    </section>

    <section id="cta-final">
      <h2 class="cta-title reveal">准备好了吗？<br />让你的<span>动画</span>活过来。</h2>
      <p class="cta-sub reveal d1">
        无论你想定制专属动画机，还是希望讨论作品合作，都可以从这里开始。
      </p>
      <div class="cta-btns reveal d2">
        <RouterLink to="/showcase" class="btn btn-yellow">挑选联名作品 →</RouterLink
        ><RouterLink to="/customize" class="btn btn-white">开始创作 →</RouterLink
        ><RouterLink to="/contact" class="btn btn-ghost">联络我们</RouterLink>
      </div>
    </section>

    <footer>
      <div class="foot-row">
        <RouterLink to="/" class="foot-logo">哞屋 MOWO</RouterLink>
        <div class="foot-links">
          <RouterLink to="/about">关于我们</RouterLink
          ><RouterLink to="/products">产品介绍</RouterLink
          ><RouterLink to="/showcase">联名商品</RouterLink
          ><RouterLink to="/customize">私人定制</RouterLink
          ><RouterLink to="/contact">联络我们</RouterLink>
        </div>
      </div>
      <p class="foot-copy">© {{ new Date().getFullYear() }} 哞屋 MOWO. All rights reserved.</p>
    </footer>
  </main>
</template>

<style scoped>
.product-fidelity-page {
  --white: #fff;
  --cream: #fef3e2;
  --black: #2c1f14;
  --gray1: #e8d8be;
  --gray2: #c0aa88;
  --gray3: #7a6552;
  --accent-y: #f0c040;
  --ease: cubic-bezier(0.22, 1, 0.36, 1);
  --pad-mob: 24px;
  --pad-desk: 72px;
  overflow: hidden;
  background: var(--cream);
  color: var(--black);
  font-family: Nunito, 'Noto Sans SC', sans-serif;
  -webkit-font-smoothing: antialiased;
}
.product-fidelity-page * {
  box-sizing: border-box;
}
.product-fidelity-page :is(h1, h2, h3, p) {
  margin: 0;
}
.product-fidelity-page a {
  color: inherit;
  text-decoration: none;
}
#hero {
  position: relative;
  display: flex;
  min-height: 100vh;
  align-items: flex-end;
  overflow: hidden;
  background: var(--black);
}
.hero-bg,
.hero-overlay {
  position: absolute;
  inset: 0;
}
.hero-bg {
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(160deg, #2a1f16, #1a100a 60%);
}
.hero-bg-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  border: 1px dashed #2a2a28;
}
.hero-bg-placeholder-icon {
  font-size: 64px;
  opacity: 0.15;
}
.hero-bg-placeholder-text {
  padding: 0 40px;
  color: #544231;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.2em;
  text-align: center;
  text-transform: uppercase;
}
.hero-overlay {
  background: linear-gradient(to top, #1a100a 0%, rgb(26 16 10 / 50%) 40%, rgb(26 16 10 / 10%));
}
.hero-content {
  position: relative;
  z-index: 2;
  width: 100%;
  padding: 0 var(--pad-mob) 56px;
}
.hero-product-name {
  margin-bottom: 16px;
  animation: fup 0.9s var(--ease) 0.2s forwards;
  color: var(--white);
  font-size: clamp(42px, 9vw, 96px);
  font-weight: 900;
  line-height: 1;
  letter-spacing: -0.03em;
  opacity: 0;
}
.hero-product-name span {
  color: var(--accent-y);
}
.hero-definition {
  max-width: 520px;
  animation: fup 0.9s var(--ease) 0.5s forwards;
  color: rgb(255 255 255 / 55%);
  font-size: clamp(16px, 2.5vw, 22px);
  font-weight: 700;
  line-height: 1.6;
  opacity: 0;
}
.hero-scroll {
  position: absolute;
  z-index: 2;
  right: var(--pad-mob);
  bottom: 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  animation: fup 0.8s var(--ease) 1.2s forwards;
  opacity: 0;
}
.hero-scroll span {
  color: rgb(255 255 255 / 30%);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.22em;
}
.hero-scroll-dot {
  width: 6px;
  height: 6px;
  animation: bdot 1.5s ease-in-out infinite;
  border-radius: 50%;
  background: rgb(255 255 255 / 30%);
}
@keyframes fup {
  to {
    transform: none;
    opacity: 1;
  }
}
@keyframes bdot {
  50% {
    transform: translateY(6px);
  }
}
.principle-strip {
  width: 100%;
  padding: 60px var(--pad-mob);
  background: var(--black);
}
.principle-inner {
  display: grid;
  max-width: 1100px;
  grid-template-columns: 1fr;
  align-items: center;
  gap: 48px;
  margin: 0 auto;
}
.principle-eyebrow,
.sec-eyebrow {
  margin-bottom: 16px;
  color: var(--gray3);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.22em;
  text-transform: uppercase;
}
.principle-title {
  margin-bottom: 20px;
  color: var(--white);
  font-size: clamp(26px, 4vw, 44px);
  font-weight: 900;
  line-height: 1.15;
}
.principle-body {
  color: rgb(255 255 255 / 50%);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.9;
}
.horse-frames {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 6px;
}
.horse-frame {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #2c1f14;
  border-radius: 8px;
  aspect-ratio: 3/4;
  background: #1e1208;
  font-size: clamp(16px, 2.5vw, 22px);
  transition: transform 0.2s;
}
.horse-frame.active {
  border-color: #c8965a;
  background: #3a2818;
}
.frames-note {
  margin-top: 16px;
  color: var(--gray3);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-align: center;
}
#why {
  padding: 120px var(--pad-mob);
  overflow: hidden;
  background: var(--cream);
}
.why-header {
  margin-bottom: 72px;
  text-align: center;
}
.sec-title {
  margin-bottom: 20px;
  color: var(--black);
  font-size: clamp(30px, 6vw, 64px);
  font-weight: 900;
  line-height: 1.1;
}
.sec-body {
  max-width: 520px;
  margin: 0 auto;
  color: var(--gray3);
  font-size: clamp(15px, 2vw, 18px);
  font-weight: 700;
  line-height: 1.8;
}
.static-row {
  display: flex;
  max-width: 1100px;
  flex-wrap: wrap;
  justify-content: center;
  gap: 16px;
  margin: 0 auto;
}
.static-item-card {
  position: relative;
  width: min(140px, 38vw);
  flex: 0 0 auto;
  overflow: hidden;
  border: 2px solid var(--gray1);
  border-radius: 20px;
  background: var(--white);
  opacity: 0.55;
}
.static-item-img {
  display: flex;
  width: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  aspect-ratio: 3/4;
  background: #eceae6;
}
.static-item-icon {
  font-size: 32px;
  opacity: 0.35;
}
.static-item-label-img {
  color: rgb(0 0 0 / 20%);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
}
.static-item-footer {
  padding: 10px 12px 12px;
}
.static-item-name {
  color: var(--gray3);
  font-size: 12px;
  font-weight: 800;
}
.why-reveal {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 32px;
  margin-top: 40px;
}
.why-arrow {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.why-arrow-line {
  width: 2px;
  height: 48px;
  border-radius: 2px;
  background: linear-gradient(to bottom, var(--gray1), var(--gray2));
}
.why-arrow-tip {
  color: var(--gray2);
  font-size: 20px;
}
.why-answer {
  width: 100%;
  max-width: 520px;
  overflow: hidden;
  border: 2px solid var(--gray1);
  border-radius: 28px;
  background: var(--white);
  box-shadow: 0 20px 60px rgb(0 0 0 / 8%);
}
.why-answer-img {
  position: relative;
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: center;
  aspect-ratio: 16/9;
  background: #fce8c8;
}
.why-answer-tag {
  position: absolute;
  top: 16px;
  left: 16px;
  padding: 5px 12px;
  border: 1.5px solid #c8965a;
  border-radius: 999px;
  background: #fce2b3;
  font-size: 11px;
  font-weight: 900;
}
.why-answer-device {
  display: flex;
  width: 72px;
  height: 96px;
  align-items: center;
  justify-content: center;
  animation: rock 3s ease-in-out infinite;
  border: 2px solid rgb(0 0 0 / 10%);
  border-radius: 16px;
  background: var(--white);
  box-shadow: 0 8px 28px rgb(0 0 0 / 10%);
}
.why-answer-ring {
  width: 32px;
  height: 32px;
  animation: spin 2s steps(8) infinite;
  border: 2.5px solid rgb(0 0 0 / 12%);
  border-radius: 50%;
}
@keyframes rock {
  50% {
    transform: rotate(3deg) translateY(-8px);
  }
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.why-answer-body {
  padding: 24px 28px 28px;
  text-align: center;
}
.why-answer-title {
  margin-bottom: 10px;
  color: var(--black);
  font-size: 20px;
  font-weight: 900;
}
.why-answer-desc {
  color: var(--gray3);
  font-size: 14px;
  font-weight: 700;
  line-height: 1.8;
}
#scenes {
  padding: 120px 0;
  background: #fffaf4;
}
.scenes-header {
  padding: 0 var(--pad-mob);
  margin-bottom: 80px;
  text-align: center;
}
.scene-row {
  display: grid;
  grid-template-columns: 1fr;
  border-top: 1px solid var(--gray1);
}
.scene-img {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 10px;
  overflow: hidden;
  aspect-ratio: 4/3;
}
.scene-row:nth-child(1) .scene-img {
  background: #f0ebe2;
}
.scene-row:nth-child(2) .scene-img {
  background: #e8e0f0;
}
.scene-row:nth-child(3) .scene-img {
  background: #e0e8f0;
}
.scene-row:nth-child(4) .scene-img {
  background: #f5ead8;
}
.scene-row:nth-child(5) .scene-img {
  background: #fce8c8;
}
.scene-img-placeholder {
  font-size: 48px;
  opacity: 0.4;
}
.scene-img-label {
  color: rgb(0 0 0 / 20%);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.15em;
}
.scene-text {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 48px var(--pad-mob);
  border-left: 1px solid var(--gray1);
}
.scene-num {
  margin-bottom: 12px;
  color: var(--gray2);
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0.15em;
}
.scene-tag {
  display: inline-flex;
  width: fit-content;
  padding: 5px 14px;
  margin-bottom: 20px;
  border-radius: 999px;
  background: rgb(200 150 90 / 18%);
  color: #7a4a1a;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.15em;
}
.scene-title {
  margin-bottom: 16px;
  color: var(--black);
  font-size: clamp(22px, 3.5vw, 34px);
  font-weight: 900;
  line-height: 1.2;
}
.scene-desc {
  max-width: 440px;
  color: var(--gray3);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.9;
}
.scene-row-dark,
.scene-row-dark .scene-img {
  background: #1a100a;
}
.scene-row-dark .scene-text {
  border-color: #3a2818;
}
.scene-row-dark .scene-title {
  color: var(--white);
}
.scene-row-dark .scene-desc {
  color: rgb(255 255 255 / 50%);
}
.scene-row-dark .scene-tag {
  background: rgb(240 192 64 / 15%);
  color: var(--accent-y);
}
.scene-action {
  width: fit-content;
  min-height: 48px;
  padding: 12px 24px;
  margin-top: 28px;
  font-size: 14px;
}
#product-boundary {
  padding: 120px var(--pad-mob);
  background: var(--cream);
}
.boundary-inner {
  max-width: 900px;
  padding: 48px;
  border: 2px solid var(--gray1);
  border-radius: 28px;
  margin: 0 auto;
  background: #fff8ed;
}
.boundary-body {
  max-width: 680px;
  color: var(--gray3);
  font-size: 16px;
  font-weight: 700;
  line-height: 1.9;
}
.boundary-actions,
.cta-btns {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 36px;
}
.btn {
  display: inline-flex;
  min-height: 56px;
  align-items: center;
  justify-content: center;
  padding: 16px 32px;
  border-radius: 999px;
  font-size: 15px;
  font-weight: 800;
  text-decoration: none;
  transition:
    transform 0.2s,
    box-shadow 0.2s;
}
.btn:hover {
  transform: translateY(-2px);
}
.btn-dark {
  background: var(--black);
  color: #fff;
}
.btn-outline {
  border: 2px solid var(--gray1);
  color: var(--gray3);
}
#cta-final {
  padding: 120px var(--pad-mob);
  background: var(--black);
  text-align: center;
}
.cta-title {
  margin-bottom: 20px;
  color: var(--white);
  font-size: clamp(32px, 7vw, 72px);
  font-weight: 900;
  line-height: 1.08;
}
.cta-title span {
  color: var(--accent-y);
}
.cta-sub {
  max-width: 480px;
  margin: 0 auto 48px;
  color: rgb(255 255 255 / 45%);
  font-size: clamp(15px, 2vw, 18px);
  font-weight: 700;
  line-height: 1.8;
}
.cta-btns {
  justify-content: center;
  margin-top: 0;
}
.btn-white {
  background: #fff;
  color: var(--black);
  box-shadow: 0 4px 0 rgb(255 255 255 / 25%);
}
.btn-yellow {
  background: var(--accent-y);
  color: var(--black);
  box-shadow: 0 4px 0 #b89030;
}
.btn-ghost {
  border: 2px solid rgb(255 255 255 / 15%);
  color: rgb(255 255 255 / 60%);
}
footer {
  padding: 48px var(--pad-mob) 36px;
  border-top: 1px solid #1e1e1c;
  background: var(--black);
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
  transition-delay: 0.08s;
}
.d2 {
  transition-delay: 0.16s;
}
@media (pointer: fine) {
  .product-fidelity-page,
  .product-fidelity-page a {
    cursor: none;
  }
  .product-cursor-dot,
  .product-cursor-ring {
    position: fixed;
    z-index: 9999;
    width: 8px;
    height: 8px;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    background: #111;
    pointer-events: none;
  }
  .product-cursor-ring {
    width: 32px;
    height: 32px;
    border: 1.5px solid rgb(17 17 16 / 30%);
    background: transparent;
    transition:
      width 0.3s,
      height 0.3s,
      opacity 0.3s;
  }
  .product-cursor-ring.is-active {
    width: 52px;
    height: 52px;
    opacity: 0.4;
  }
}
@media (min-width: 640px) {
  .static-row {
    flex-wrap: nowrap;
    gap: 24px;
  }
  .foot-row {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
}
@media (min-width: 768px) {
  .principle-inner {
    grid-template-columns: 1fr 1fr;
    gap: 80px;
  }
  .scene-row {
    min-height: 480px;
    grid-template-columns: 1fr 1fr;
  }
  .scene-row.reverse .scene-img {
    order: 2;
  }
  .scene-row.reverse .scene-text {
    order: 1;
    border-right: 1px solid var(--gray1);
    border-left: 0;
  }
  .scene-img {
    aspect-ratio: auto;
  }
}
@media (min-width: 1024px) {
  .hero-content {
    max-width: 760px;
    padding: 0 var(--pad-desk) 80px;
  }
  .hero-scroll {
    right: var(--pad-desk);
  }
  .principle-strip {
    padding: 80px var(--pad-desk);
  }
  #why,
  #product-boundary,
  #cta-final {
    padding: 140px var(--pad-desk);
  }
  .scenes-header {
    padding: 0 var(--pad-desk);
  }
  .scene-text {
    padding: 64px var(--pad-desk);
  }
  footer {
    padding: 48px var(--pad-desk) 36px;
  }
}
@media (max-width: 767px) {
  .scene-row.reverse .scene-text {
    border-right: 0;
  }
}
</style>
