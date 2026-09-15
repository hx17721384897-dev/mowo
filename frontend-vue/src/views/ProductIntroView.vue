<script setup lang="ts">
import { legacyPublicUrl } from '@/config/public-links'
</script>

<template>
  <main>
    <section class="product-hero">
      <div class="page-width product-hero__inner">
        <div>
          <p class="section-kicker">MOWO ANIMATION MACHINE</p>
          <h1>一台让逐帧画面<br /><em>在现实中播放</em>的装置。</h1>
          <p>转动手柄，连续静止画面依次经过视线，动画由你的动作亲手发生。</p>
        </div>
        <div class="frame-strip" aria-hidden="true">
          <span v-for="index in 8" :key="index" :style="{ '--frame': index }">{{ index }}</span>
        </div>
      </div>
    </section>

    <section class="how-section page-width">
      <div class="section-heading">
        <p class="section-kicker">HOW IT WORKS</p>
        <h2>三个动作，从素材到实体动画。</h2>
      </div>
      <ol class="step-list">
        <li>
          <span>01</span>
          <div>
            <h3>准备连续画面</h3>
            <p>上传视频或图片，并筛选出适合循环播放的关键帧。</p>
          </div>
        </li>
        <li>
          <span>02</span>
          <div>
            <h3>选择正式款式</h3>
            <p>按照系统当前提供的 SKU、帧数要求和最终价格进行确认。</p>
          </div>
        </li>
        <li>
          <span>03</span>
          <div>
            <h3>进入生产履约</h3>
            <p>订单确认后，帧图、材料和每件实物分别进入可追溯的生产流程。</p>
          </div>
        </li>
      </ol>
    </section>

    <section class="use-section">
      <div class="page-width">
        <div class="section-heading section-heading--light">
          <p class="section-kicker">MAKE IT YOURS</p>
          <h2>你的画面，可以有不同的开始方式。</h2>
        </div>
        <div class="use-grid">
          <article>
            <span>原创动画</span>
            <h3>把自己绘制的逐帧作品做成实体。</h3>
          </article>
          <article>
            <span>私人记忆</span>
            <h3>从有权使用的视频或图片中挑选连续画面。</h3>
          </article>
          <article>
            <span>联名合作</span>
            <h3>由团队人工确认授权、商品配置和制作条件。</h3>
          </article>
        </div>
      </div>
    </section>

    <section class="boundary-card page-width">
      <div>
        <p class="section-kicker">PRODUCT INFORMATION</p>
        <h2>规格与价格只使用实时正式数据。</h2>
      </div>
      <p>
        本介绍页不继续展示旧页面中未经确认的材质、颜色、帧数、交期或售后承诺。购买与定制时，请以联名详情或款式确认页面返回的信息为准。
      </p>
    </section>

    <section class="closing-cta closing-cta--yellow">
      <div>
        <p class="section-kicker">START A STORY</p>
        <h2>让你的画面动起来。</h2>
      </div>
      <div class="action-row">
        <a class="primary-action" :href="legacyPublicUrl('customize-start')">开始私人定制</a>
        <RouterLink class="secondary-action" to="/showcase">浏览联名商品</RouterLink>
      </div>
    </section>
  </main>
</template>
