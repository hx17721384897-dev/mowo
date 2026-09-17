<script setup lang="ts">
/* eslint-disable vue/html-closing-bracket-newline, vue/html-indent */
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useDecorativeCursor } from '@/composables/useDecorativeCursor'
import ContactModal from '@/features/contact/ContactModal.vue'
import { contactDefinitions } from '@/features/contact/definitions'
import type { ContactDefinition } from '@/features/contact/types'

const activeDefinition = ref<ContactDefinition | null>(null)
const openFaq = ref<number | null>(null)
const opener = ref<HTMLElement | null>(null)
const decorativeCursor = useDecorativeCursor('a, button, .contact-card')
let observer: IntersectionObserver | null = null

const faqs = [
  {
    question: '提交联络信息需要登录账号吗？',
    answer:
      '不需要。六类联络都允许匿名提交；如果你已经登录，服务端会依据当前会话自动绑定账号，客户端不会自行声明你的用户身份。'
  },
  {
    question: '哪些联络类型可以上传附件？',
    answer:
      '只有画师/IP 合作可以上传 JPG、PNG 或 PDF 作品集，加入哞屋可以上传一份 PDF 简历。其他类型使用结构化文字和 HTTP/HTTPS 外部链接。'
  },
  {
    question: '我可以同时提交多种合作申请吗？',
    answer: '可以。每种联络类型独立记录，请按实际需求分别提交，避免在同一表单中混合无关资料。'
  },
  {
    question: '我提交的信息会被如何使用？',
    answer:
      '信息用于评估本次联络事项和必要的后续沟通，仅由授权工作人员及提供必要技术服务的受控服务方按职责处理。具体范围和留存规则请查看隐私政策。'
  },
  {
    question: '提交后一定会收到回复吗？',
    answer:
      '工作人员会人工查看提交内容，但当前不承诺固定回复时限或每条信息都能进入后续合作。资料越清楚，越有助于完成评估。'
  }
]

function openContact(definition: ContactDefinition, event: MouseEvent): void {
  opener.value = event.currentTarget as HTMLElement
  activeDefinition.value = definition
}

async function closeContact(): Promise<void> {
  activeDefinition.value = null
  await nextTick()
  opener.value?.focus()
}

function scrollTo(id: string): void {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

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
    .querySelectorAll('.contact-fidelity-page .reveal')
    .forEach((element) => observer?.observe(element))
})

onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <main class="contact-fidelity-page">
    <div :ref="decorativeCursor.cursorDot" class="contact-cursor-dot" />
    <div :ref="decorativeCursor.cursorRing" class="contact-cursor-ring" />

    <section class="page-hero">
      <div class="hero-dot dot1" />
      <div class="hero-dot dot2" />
      <div class="hero-dot dot3" />
      <div class="hero-content">
        <p class="hero-eyebrow">联络我们 · CONTACT</p>
        <h1 class="hero-title">我们很想<br /><em>认识你</em></h1>
        <p class="hero-sub">
          无论你是想合作的伙伴、想加入的同路人，还是有产品问题和建议，都可以从这里联系哞屋。
        </p>
        <div class="hero-ctas">
          <a href="#cards" class="btn-hero-primary" @click.prevent="scrollTo('cards')"
            >联络我们 →</a
          >
          <a href="#contact-faq" class="btn-hero-ghost" @click.prevent="scrollTo('contact-faq')"
            >常见问题</a
          >
        </div>
      </div>
    </section>

    <section id="cards" class="cards-section">
      <div class="cards-grid">
        <button
          v-for="(definition, index) in contactDefinitions"
          :key="definition.type"
          type="button"
          class="contact-card reveal"
          :class="[`card-${definition.type}`, `d${index % 3}`]"
          @click="openContact(definition, $event)"
        >
          <span>
            <span class="card-icon" aria-hidden="true">{{ definition.icon }}</span>
            <span class="card-tag">{{ definition.cardTitle }}</span>
            <span class="card-title">{{ definition.cardSubtitle }}</span>
          </span>
          <span class="card-cta">
            {{ definition.cardAction }}
            <span class="card-cta-arrow" aria-hidden="true">→</span>
          </span>
        </button>
      </div>
    </section>

    <section id="contact-faq" class="faq-section">
      <div class="faq-inner">
        <div class="faq-header">
          <h2 class="faq-title reveal">常见问题</h2>
          <RouterLink to="/faq" class="faq-see-all">查看全部 →</RouterLink>
        </div>
        <div class="faq-list reveal d1">
          <article
            v-for="(item, index) in faqs"
            :key="item.question"
            class="faq-item"
            :class="{ open: openFaq === index }"
          >
            <button
              class="faq-q"
              type="button"
              :aria-expanded="openFaq === index"
              :aria-controls="`contact-faq-answer-${index}`"
              @click="openFaq = openFaq === index ? null : index"
            >
              <span>{{ item.question }}</span
              ><span class="faq-arrow" aria-hidden="true">↓</span>
            </button>
            <div :id="`contact-faq-answer-${index}`" class="faq-a">
              <div class="faq-a-inner">{{ item.answer }}</div>
            </div>
          </article>
        </div>
      </div>
    </section>

    <section class="promise-section">
      <div class="promise-inner reveal">
        <div class="promise-icon" aria-hidden="true">⚡</div>
        <h2 class="promise-title">每一条联络都会进入人工评估</h2>
        <p class="promise-body">
          请尽量清楚描述你的身份、事项和希望讨论的方向，只提交完成本次沟通所必需的信息。工作人员会按类型整理并根据实际情况决定后续联络。
        </p>
        <div class="promise-stats">
          <div class="stat">
            <span class="stat-num">6</span><span class="stat-label">类联络入口</span>
          </div>
          <div class="stat">
            <span class="stat-num stat-word">人工</span><span class="stat-label">评估与跟进</span>
          </div>
          <div class="stat">
            <span class="stat-num stat-word">受控</span><span class="stat-label">附件与访问</span>
          </div>
        </div>
      </div>
    </section>

    <footer>
      <div class="foot-row">
        <RouterLink to="/" class="foot-logo">哞屋 MOWO</RouterLink>
        <div class="foot-links">
          <RouterLink to="/about">关于我们</RouterLink>
          <RouterLink to="/products">产品介绍</RouterLink>
          <RouterLink to="/showcase">画师联名</RouterLink>
          <RouterLink to="/legal/privacy">隐私政策</RouterLink>
        </div>
      </div>
      <p class="foot-copy">© {{ new Date().getFullYear() }} 哞屋 MOWO. All rights reserved.</p>
    </footer>

    <ContactModal v-if="activeDefinition" :definition="activeDefinition" @close="closeContact" />
  </main>
</template>

<style scoped>
.contact-fidelity-page {
  --white: #fff;
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
  overflow-x: hidden;
  background: var(--cream);
  color: var(--black);
  font-family: Nunito, 'Noto Sans SC', sans-serif;
  -webkit-font-smoothing: antialiased;
}
.contact-fidelity-page * {
  box-sizing: border-box;
}
.contact-fidelity-page :is(h1, h2, p) {
  margin: 0;
}
.contact-fidelity-page a {
  color: inherit;
  text-decoration: none;
}
.page-hero {
  position: relative;
  display: flex;
  min-height: calc(100vh - var(--nav-h));
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px var(--pad-mob) 48px;
  overflow: hidden;
  text-align: center;
}
.hero-content {
  display: flex;
  width: 100%;
  max-width: 560px;
  flex-direction: column;
  align-items: center;
}
.hero-ctas {
  display: flex;
  width: 100%;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin-top: 32px;
  animation: contact-fup 0.8s var(--ease) 0.8s forwards;
  opacity: 0;
}
.btn-hero-primary,
.btn-hero-ghost {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 14px 32px;
  border: 2px solid transparent;
  border-radius: 999px;
  font-size: 15px;
  font-weight: 900;
}
.btn-hero-primary {
  background: var(--black);
  color: var(--white) !important;
  transition:
    opacity 0.2s,
    transform 0.1s;
}
.btn-hero-primary:hover {
  opacity: 0.85;
}
.btn-hero-ghost {
  border-color: var(--gray1);
  background: transparent;
  color: var(--black);
  transition:
    border-color 0.2s,
    background 0.2s;
}
.btn-hero-ghost:hover {
  border-color: var(--gray2);
  background: rgb(44 31 20 / 4%);
}
.hero-dot {
  position: absolute;
  border-radius: 50%;
  animation: contact-dot-float 6s ease-in-out infinite;
  pointer-events: none;
}
.dot1 {
  top: -20px;
  left: -30px;
  width: 100px;
  height: 100px;
  background: var(--accent-y);
  opacity: 0.12;
}
.dot2 {
  top: 10px;
  right: -20px;
  width: 70px;
  height: 70px;
  animation-delay: 1.2s;
  background: var(--accent-o);
  opacity: 0.1;
}
.dot3 {
  bottom: 0;
  left: 30%;
  width: 50px;
  height: 50px;
  animation-delay: 2.4s;
  background: #c8965a;
  opacity: 0.15;
}
.hero-eyebrow {
  margin-bottom: 12px;
  animation: contact-fup 0.8s var(--ease) 0.2s forwards;
  color: var(--gray3);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.25em;
  opacity: 0;
  text-transform: uppercase;
}
.hero-title {
  margin-bottom: 12px !important;
  animation: contact-fup 0.8s var(--ease) 0.4s forwards;
  color: var(--black);
  font-size: clamp(28px, 4.5vw, 52px);
  font-weight: 900;
  letter-spacing: -0.03em;
  line-height: 1.1;
  opacity: 0;
}
.hero-title em {
  position: relative;
  display: inline-block;
  font-style: normal;
}
.hero-title em::after {
  position: absolute;
  z-index: -1;
  right: 0;
  bottom: 3px;
  left: 0;
  height: 6px;
  border-radius: 4px;
  background: #fce2b3;
  content: '';
}
.hero-sub {
  max-width: 440px;
  animation: contact-fup 0.8s var(--ease) 0.6s forwards;
  color: var(--gray3);
  font-size: clamp(13px, 1.6vw, 15px);
  font-weight: 700;
  line-height: 1.75;
  opacity: 0;
  text-align: center;
}
#cards,
#contact-faq {
  scroll-margin-top: calc(var(--nav-h) + 16px);
}
.cards-section {
  padding: 0 var(--pad-mob) 80px;
}
.cards-grid {
  display: grid;
  max-width: 1200px;
  grid-template-columns: 1fr;
  gap: 16px;
  margin: 0 auto;
}
.contact-card {
  position: relative;
  display: flex;
  min-height: 0;
  flex-direction: column;
  justify-content: space-between;
  padding: 18px 20px 16px;
  overflow: hidden;
  border: 2px solid var(--gray1);
  border-radius: 24px;
  background: var(--white);
  color: var(--black);
  font-family: inherit;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
  transition:
    transform 0.3s var(--ease),
    box-shadow 0.3s,
    border-color 0.3s;
}
.contact-card:hover {
  border-color: var(--gray2);
  box-shadow: 0 24px 64px rgb(44 31 20 / 10%);
  transform: translateY(-6px);
}
.contact-card:active {
  transform: scale(0.98);
}
.contact-card::before {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 5px;
  border-radius: 4px 0 0 4px;
  content: '';
  transition: width 0.3s var(--ease);
}
.contact-card:hover::before {
  width: 8px;
}
.card-artist::before {
  background: #c8965a;
}
.card-channel::before {
  background: #b87840;
}
.card-media::before {
  background: #d4a843;
}
.card-join::before {
  background: #f0c040;
}
.card-feedback::before {
  background: #e8662a;
}
.card-factory::before {
  background: #8a5a30;
}
.card-icon {
  display: block;
  margin-bottom: 10px;
  font-size: 30px;
  line-height: 1;
  transition: transform 0.3s var(--ease);
}
.contact-card:hover .card-icon {
  transform: scale(1.15) rotate(-5deg);
}
.card-tag {
  display: block;
  margin-bottom: 6px;
  color: var(--black);
  font-size: clamp(18px, 2.2vw, 24px);
  font-weight: 900;
  letter-spacing: -0.01em;
  line-height: 1.2;
}
.card-title {
  display: block;
  margin-bottom: 10px;
  color: var(--gray3);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.01em;
  line-height: 1.5;
}
.card-cta {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 8px;
  color: var(--black);
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0.04em;
  transition: gap 0.25s var(--ease);
}
.contact-card:hover .card-cta {
  gap: 14px;
}
.card-cta-arrow {
  display: flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--black);
  color: var(--white);
  font-size: 14px;
  transition: transform 0.25s var(--ease);
}
.contact-card:hover .card-cta-arrow {
  transform: translateX(4px);
}
.faq-section {
  padding: 80px var(--pad-mob);
  background: var(--cream);
}
.faq-inner {
  max-width: 1200px;
  margin: 0 auto;
}
.faq-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 32px;
}
.faq-title {
  color: var(--black);
  font-size: clamp(22px, 3.5vw, 32px);
  font-weight: 900;
  letter-spacing: -0.02em;
}
.faq-see-all {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
  color: var(--gray3) !important;
  font-size: 13px;
  font-weight: 800;
  transition: color 0.2s;
}
.faq-see-all:hover {
  color: var(--black) !important;
}
.faq-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.faq-item {
  overflow: hidden;
  border: 2px solid var(--gray1);
  border-radius: 16px;
  background: var(--white);
  transition: border-color 0.25s;
}
.faq-item.open {
  border-color: var(--gray2);
}
.faq-q {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 22px;
  border: 0;
  background: none;
  color: var(--black);
  font-family: inherit;
  font-size: 15px;
  font-weight: 800;
  text-align: left;
  transition: background 0.2s;
}
.faq-q:hover {
  background: rgb(44 31 20 / 3%);
}
.faq-arrow {
  flex-shrink: 0;
  color: var(--gray2);
  font-size: 16px;
  transition:
    transform 0.35s var(--ease),
    color 0.2s;
}
.faq-item.open .faq-arrow {
  color: var(--black);
  transform: rotate(180deg);
}
.faq-a {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.4s var(--ease);
}
.faq-item.open .faq-a {
  max-height: 300px;
}
.faq-a-inner {
  padding: 0 22px 20px;
  color: var(--gray3);
  font-size: 14px;
  font-weight: 700;
  line-height: 1.85;
}
.promise-section {
  padding: 80px var(--pad-mob);
  background: var(--black);
  text-align: center;
}
.promise-inner {
  max-width: 700px;
  margin: 0 auto;
}
.promise-icon {
  margin-bottom: 20px;
  font-size: 48px;
}
.promise-title {
  margin-bottom: 16px !important;
  color: var(--white);
  font-size: clamp(24px, 4vw, 40px);
  font-weight: 900;
  letter-spacing: -0.02em;
}
.promise-body {
  margin-bottom: 36px !important;
  color: rgb(255 255 255 / 45%);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.9;
}
.promise-stats {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 48px;
}
.stat {
  text-align: center;
}
.stat-num {
  display: block;
  color: var(--accent-y);
  font-size: clamp(28px, 5vw, 48px);
  font-weight: 900;
  letter-spacing: -0.03em;
  line-height: 1;
}
.stat-word {
  font-size: clamp(24px, 4vw, 40px);
}
.stat-label {
  display: block;
  margin-top: 6px;
  color: rgb(255 255 255 / 30%);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
}
footer {
  padding: 48px var(--pad-mob) 36px;
  border-top: 1px solid rgb(255 255 255 / 8%);
  background: var(--black);
  color: rgb(255 255 255 / 40%);
}
.foot-row {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.foot-logo {
  color: var(--white) !important;
  font-size: 20px;
  font-weight: 900;
  letter-spacing: -0.01em;
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
  transition: color 0.2s;
}
.foot-links a:hover {
  color: var(--white);
}
.foot-copy {
  margin-top: 24px !important;
  color: rgb(255 255 255 / 18%);
  font-size: 12px;
  font-weight: 700;
}
.reveal {
  opacity: 0;
  transform: translateY(24px);
  transition:
    opacity 0.7s var(--ease),
    transform 0.7s var(--ease);
}
.reveal.on {
  opacity: 1;
  transform: none;
}
.d1 {
  transition-delay: 0.08s;
}
.d2 {
  transition-delay: 0.16s;
}
.d3 {
  transition-delay: 0.24s;
}
@keyframes contact-dot-float {
  0%,
  100% {
    transform: translateY(0) scale(1);
  }
  50% {
    transform: translateY(-14px) scale(1.05);
  }
}
@keyframes contact-fup {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@media (pointer: fine) {
  .contact-fidelity-page,
  .contact-fidelity-page a,
  .contact-fidelity-page button {
    cursor: none;
  }
  .contact-cursor-dot,
  .contact-cursor-ring {
    position: fixed;
    z-index: 9999;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--black);
    pointer-events: none;
    transform: translate(-50%, -50%);
  }
  .contact-cursor-ring {
    width: 32px;
    height: 32px;
    border: 1.5px solid rgb(44 31 20 / 25%);
    background: transparent;
    transition:
      width 0.3s,
      height 0.3s,
      opacity 0.3s;
  }
  .contact-cursor-ring.is-active {
    width: 52px;
    height: 52px;
    opacity: 0.4;
  }
}
@media (min-width: 560px) {
  .cards-grid {
    grid-template-columns: 1fr 1fr;
  }
}
@media (min-width: 640px) {
  .foot-row {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
}
@media (min-width: 1024px) {
  .page-hero {
    padding: 60px var(--pad-desk) 48px;
  }
  .cards-section {
    padding: 0 var(--pad-desk) 100px;
  }
  .cards-grid {
    grid-template-columns: repeat(3, 1fr);
  }
  .faq-section,
  .promise-section {
    padding: 80px var(--pad-desk);
  }
  footer {
    padding: 48px var(--pad-desk) 36px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .hero-dot,
  .hero-ctas,
  .hero-eyebrow,
  .hero-title,
  .hero-sub,
  .reveal {
    animation: none;
    opacity: 1;
    transform: none;
    transition: none;
  }
}
</style>
