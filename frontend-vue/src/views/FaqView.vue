<script setup lang="ts">
import { computed, ref } from 'vue'
import { legacyPublicUrl } from '@/config/public-links'
import { faqCategories, faqItems } from '@/content/public-content'

const query = ref('')
const category = ref<(typeof faqCategories)[number]['id']>('all')

const filteredItems = computed(() => {
  const normalizedQuery = query.value.trim().toLocaleLowerCase('zh-CN')
  return faqItems.filter((item) => {
    const categoryMatches = category.value === 'all' || item.category === category.value
    const queryMatches =
      !normalizedQuery ||
      `${item.question}${item.answer}`.toLocaleLowerCase('zh-CN').includes(normalizedQuery)
    return categoryMatches && queryMatches
  })
})
</script>

<template>
  <main>
    <section class="faq-hero-vue">
      <div class="page-width">
        <p class="section-kicker">HELP & BOUNDARIES</p>
        <h1>常见问题</h1>
        <p>这里的回答只描述当前真实范围，不使用旧页面里的占位承诺。</p>
        <label class="faq-search">
          <span>搜索问题</span>
          <input v-model="query" type="search" placeholder="例如：私人定制、支付、社区" />
        </label>
      </div>
    </section>

    <section class="faq-main page-width">
      <div class="faq-tabs" role="tablist" aria-label="问题分类">
        <button
          v-for="item in faqCategories"
          :key="item.id"
          type="button"
          :class="{ active: category === item.id }"
          @click="category = item.id"
        >
          {{ item.label }}
        </button>
      </div>
      <p class="faq-count" aria-live="polite">找到 {{ filteredItems.length }} 个问题</p>
      <div v-if="filteredItems.length" class="faq-list-vue">
        <details v-for="item in filteredItems" :key="item.id">
          <summary>{{ item.question }}<span aria-hidden="true">+</span></summary>
          <p>{{ item.answer }}</p>
        </details>
      </div>
      <div v-else class="empty-search" role="status">
        <h2>没有找到相关问题</h2>
        <p>换一个关键词，或直接联系工作人员。</p>
      </div>
      <div class="faq-contact">
        <div>
          <h2>仍然需要帮助？</h2>
          <p>联络表单将在 V1c 迁入 Vue；当前继续使用经过权限校验的旧入口。</p>
        </div>
        <a class="primary-action" :href="legacyPublicUrl('contact')">联络我们</a>
      </div>
    </section>
  </main>
</template>
