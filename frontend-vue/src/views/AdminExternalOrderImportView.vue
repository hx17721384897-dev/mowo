<script setup lang="ts">
import { ref } from 'vue'
import AdminSidebar from '@/components/AdminSidebar.vue'
import './admin-external-order-import.css'

const mobileOpen = ref(false)
const collapsed = ref(false)
</script>

<template>
  <div class="admin-external-import-page">
    <AdminSidebar v-model:mobile-open="mobileOpen" v-model:collapsed="collapsed" />
    <div class="main" :class="{ expanded: collapsed }">
      <header class="topbar">
        <button class="menu-btn" type="button" aria-label="打开后台菜单" @click="mobileOpen = true">
          ☰
        </button>
        <span class="topbar-title">外部平台订单导入</span>
        <span class="status-chip">待配置</span>
      </header>

      <main class="content">
        <section class="intro-card" aria-labelledby="external-import-title">
          <div class="intro-icon" aria-hidden="true">📥</div>
          <div>
            <p class="eyebrow">内部功能入口</p>
            <h1 id="external-import-title">等待真实平台样表后再接入</h1>
            <p class="intro-copy">
              当前版本不假设淘宝、抖音、小红书或其他平台的表格列名，也不提供未经确认的上传模板。
              导入接口已由服务端关闭，进入本页不会读取、创建或修改任何订单。
            </p>
          </div>
        </section>

        <section class="boundary-grid" aria-label="外部订单导入启用边界">
          <article class="boundary-card">
            <span class="step">01</span>
            <h2>取得真实样表</h2>
            <p>
              使用实际平台导出的脱敏文件确认编码、列名、订单与商品行关系，不以示例字段代替事实。
            </p>
          </article>
          <article class="boundary-card">
            <span class="step">02</span>
            <h2>确认业务归属</h2>
            <p>明确渠道客户、数量、SKU、联名商品、收件信息和履约类型如何进入正式订单结构。</p>
          </article>
          <article class="boundary-card">
            <span class="step">03</span>
            <h2>完成安全验收</h2>
            <p>补齐预检、逐行错误、幂等、事务、库存和权限测试后，才开放上传与异常处理。</p>
          </article>
        </section>

        <section class="retained-card">
          <div>
            <h2>已保留的内容</h2>
            <p>历史外部订单、SKU 映射和渠道数据仍保留在数据库中，本阶段没有删除或转换数据。</p>
          </div>
          <div class="retained-state">
            <span class="state-dot" aria-hidden="true"></span>
            入口保留 · 写入关闭
          </div>
        </section>
      </main>
    </div>
  </div>
</template>
