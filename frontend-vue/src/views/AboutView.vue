<script setup lang="ts">
import { legacyPublicUrl } from '@/config/public-links'
</script>

<template>
  <main>
    <section class="editorial-hero page-width">
      <p class="section-kicker">ABOUT MOWO</p>
      <h1>让每一帧热爱，<br /><em>不只停留在屏幕里。</em></h1>
      <p>哞屋关注逐帧动画与实体文创之间的可能：让创作者的画面成为可以转动、陈列和分享的作品。</p>
    </section>

    <section class="story-section">
      <div class="page-width story-section__grid">
        <div class="section-heading">
          <p class="section-kicker">OUR DIRECTION</p>
          <h2>从一台会动的装置，走向可靠的制作与合作流程。</h2>
        </div>
        <div class="story-copy">
          <p>
            动态内容常常被困在手机里。哞屋想做的，是把连续画面变成真实物件，让观看重新带有手感、节奏和陪伴。
          </p>
          <p>
            项目目前仍在建设中。我们优先把联名商品、私人定制、订单、库存和生产履约做扎实，不用尚未成熟的社区或线上收益功能制造虚假的完整感。
          </p>
          <p>
            合作作品由工作人员人工核验权利、生产效果和合作条件。旧创作者自助系统已经退役，未来若扩展也会重新设计。
          </p>
        </div>
      </div>
    </section>

    <section class="belief-section page-width">
      <div class="section-heading">
        <p class="section-kicker">WHAT WE VALUE</p>
        <h2>三件持续坚持的事。</h2>
      </div>
      <div class="belief-grid">
        <article>
          <span>01</span>
          <h3>尊重作品权利</h3>
          <p>合作之前先确认授权与用途，不让公开展示变成任意复制的许可。</p>
        </article>
        <article>
          <span>02</span>
          <h3>认真对待制造</h3>
          <p>从最终帧图、SKU 到单件生产和装箱，建立可追溯的履约关系。</p>
        </article>
        <article>
          <span>03</span>
          <h3>诚实表达进度</h3>
          <p>尚未验证的配送、支付、售后和平台能力，不写成已经兑现的承诺。</p>
        </article>
      </div>
    </section>

    <section class="closing-cta">
      <div>
        <p class="section-kicker">WORK WITH US</p>
        <h2>有作品或合作想法？</h2>
        <p>当前由工作人员人工沟通和确认，不要求先加入创作者平台。</p>
      </div>
      <a class="primary-action" :href="legacyPublicUrl('contact')">联络我们</a>
    </section>
  </main>
</template>
