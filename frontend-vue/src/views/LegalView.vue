<script setup lang="ts">
import { computed } from 'vue'
import { agreementSections, privacySections } from '@/content/public-content'

const props = defineProps<{ document: 'terms' | 'privacy' }>()
const isTerms = computed(() => props.document === 'terms')
const title = computed(() => (isTerms.value ? '哞屋用户协议' : '哞屋隐私政策'))
const version = computed(() => (isTerms.value ? 'test-2026-08' : 'dev-2026-08'))
const sections = computed(() => (isTerms.value ? agreementSections : privacySections))
</script>

<template>
  <main class="legal-page page-width">
    <aside class="draft-notice">
      <strong>测试草案，不是正式上线法律文本</strong>
      <p>
        邀请真实用户前，必须补全运营主体、注册地址、有效联系方式及相应第三方处理清单，并由专业人员复核。
      </p>
    </aside>
    <article class="legal-document">
      <header>
        <p class="section-kicker">LEGAL DRAFT</p>
        <h1>{{ title }}</h1>
        <p>版本：{{ version }} · 更新日期：2026 年 8 月 13 日 · 适用阶段：内部测试</p>
      </header>
      <section v-for="section in sections" :key="section.title">
        <h2>{{ section.title }}</h2>
        <p v-for="paragraph in section.paragraphs" :key="paragraph">{{ paragraph }}</p>
        <ul v-if="section.items">
          <li v-for="item in section.items" :key="item">{{ item }}</li>
        </ul>
      </section>
    </article>
  </main>
</template>
