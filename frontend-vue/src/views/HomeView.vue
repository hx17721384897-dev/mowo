<script setup lang="ts">
import { legacyPublicUrl } from '@/config/public-links'
</script>

<template>
  <main>
    <section class="hero-section">
      <div class="hero-section__copy">
        <p class="section-kicker">MOWO FRAME BY FRAME</p>
        <h1>转动手柄，<br /><em>让创意动起来。</em></h1>
        <p class="hero-section__lead">
          把连续画面装进一台实体动画机。每次转动，都是一段可以触摸的故事。
        </p>
        <div class="action-row">
          <a class="primary-action" :href="legacyPublicUrl('customize-start')">开始私人定制</a>
          <a class="secondary-action" :href="legacyPublicUrl('showcase')">浏览联名商品</a>
        </div>
        <p class="scope-note">当前处于未上线开发阶段，网页真实支付暂未开放。</p>
      </div>
      <div class="motion-object" aria-label="逐帧动画原理示意图">
        <div class="motion-object__disc">
          <span v-for="index in 12" :key="index" :style="{ '--slot': index - 1 }" />
        </div>
        <div class="motion-object__handle" />
        <p>12 FRAME / HAND DRIVEN</p>
      </div>
    </section>

    <section class="principles-section page-width" aria-labelledby="principles-title">
      <div class="section-heading">
        <p class="section-kicker">A SIMPLE MECHANISM</p>
        <h2 id="principles-title">静止的每一帧，<br />在转动中连成故事。</h2>
      </div>
      <div class="principle-grid">
        <article>
          <span>01</span>
          <h3>逐帧播放</h3>
          <p>连续画面依次经过视线，形成流畅的动态效果。</p>
        </article>
        <article>
          <span>02</span>
          <h3>纯机械驱动</h3>
          <p>手柄控制播放节奏，无需把观看体验交给屏幕。</p>
        </article>
        <article>
          <span>03</span>
          <h3>实体留存</h3>
          <p>把数字画面变成一件可以触摸、陈列和赠送的作品。</p>
        </article>
      </div>
    </section>

    <section class="path-section">
      <div class="page-width">
        <div class="section-heading section-heading--light">
          <p class="section-kicker">TWO WAYS TO START</p>
          <h2>选择作品，或者制作自己的作品。</h2>
        </div>
        <div class="path-grid">
          <article class="path-card path-card--collab">
            <p>联名商品</p>
            <h3>经过工作人员核验与配置的正式作品。</h3>
            <p>公开货架只展示明确审核、配置并上架的商品。</p>
            <a :href="legacyPublicUrl('showcase')">进入联名货架 <span>↗</span></a>
          </article>
          <article class="path-card path-card--custom">
            <p>私人定制</p>
            <h3>用自己的视频或图片，制作专属动画。</h3>
            <p>可以自己筛帧，也可以请工作人员协助处理画面。</p>
            <a :href="legacyPublicUrl('customize-start')">开始制作 <span>↗</span></a>
          </article>
        </div>
      </div>
    </section>

    <section class="truth-section page-width">
      <p class="section-kicker">CLEAR BOUNDARIES</p>
      <h2>当前开放什么，页面就只承诺什么。</h2>
      <div class="truth-grid">
        <p><strong>保留</strong> 联名商品、私人定制、订单、库存与生产履约。</p>
        <p><strong>关闭</strong> 网页真实支付，等待微信支付链路完成专项验收。</p>
        <p><strong>已退役</strong> 社区、线上分红、提现、牛量和创作者自助旧系统。</p>
      </div>
      <RouterLink class="text-action" to="/products">进一步了解产品原理 →</RouterLink>
    </section>
  </main>
</template>
