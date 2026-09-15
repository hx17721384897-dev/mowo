<script setup lang="ts">
import { computed } from 'vue'
import { agreementSections, privacySections } from '@/content/public-content'

const props = defineProps<{ document: 'terms' | 'privacy' }>()
const isTerms = computed(() => props.document === 'terms')
const title = computed(() => (isTerms.value ? '哞屋用户协议' : '哞屋隐私政策'))
const version = computed(() => (isTerms.value ? 'test-2026-08' : 'dev-2026-08'))
const sections = computed(() => (isTerms.value ? agreementSections : privacySections))
const notice = computed(() =>
  isTerms.value
    ? '邀请真实用户前，必须补全运营主体、注册地址、有效联系方式及争议处理信息，并由专业人员复核。'
    : '邀请真实用户前，必须补全个人信息处理者名称、注册地址、有效联系方式、第三方处理清单、具体保存期限和正式部署位置，并由专业人员复核。'
)
</script>

<template>
  <div class="legal-shell">
    <header class="legal-header"><RouterLink to="/">哞屋 MOWO</RouterLink></header>
    <main class="legal-wrap">
      <aside class="legal-notice">
        <strong>测试草案，不是正式上线法律文本。</strong>
        {{ notice }}
      </aside>
      <article class="legal-document">
        <h1>{{ title }}</h1>
        <p class="legal-meta">版本：{{ version }} · 更新日期：2026年8月13日 · 适用阶段：内部测试</p>
        <section v-for="section in sections" :key="section.title">
          <h2>{{ section.title }}</h2>
          <p v-for="paragraph in section.paragraphs" :key="paragraph">{{ paragraph }}</p>
          <ul v-if="section.items">
            <li v-for="item in section.items" :key="item">{{ item }}</li>
          </ul>
        </section>
      </article>
    </main>
  </div>
</template>

<style scoped>
.legal-shell {
  min-height: 100vh;
  background: #f6f5f2;
  color: #171716;
  font-family: 'Noto Sans SC', 'Microsoft YaHei', sans-serif;
  line-height: 1.8;
}

.legal-header {
  padding: 18px 24px;
  background: #111;
  color: #fff;
}

.legal-header a {
  color: #fff;
  font-weight: 900;
  text-decoration: none;
}

.legal-wrap {
  width: min(860px, calc(100% - 32px));
  margin: 32px auto 64px;
}

.legal-notice {
  margin-bottom: 24px;
  padding: 16px 18px;
  border-left: 5px solid #e03030;
  background: #fff4f4;
  font-weight: 700;
}

.legal-document {
  padding: 28px 34px;
  border: 1px solid #e4e2dd;
  background: #fff;
}

.legal-document h1 {
  margin: 0 0 8px;
  font-size: 30px;
}

.legal-meta {
  margin-bottom: 28px;
  color: #666;
  font-size: 14px;
}

.legal-document h2 {
  margin: 30px 0 8px;
  font-size: 19px;
}

.legal-document p,
.legal-document li {
  font-size: 15px;
}

@media (max-width: 600px) {
  .legal-document {
    padding: 22px 18px;
  }

  .legal-document h1 {
    font-size: 25px;
  }
}
</style>
