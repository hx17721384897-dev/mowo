<template>
  <footer class="site-footer">
    <div class="site-footer__main">
      <div>
        <p class="site-footer__brand">MOWO · 哞屋造物</p>
        <p class="site-footer__summary">让逐帧画面成为可以触摸、转动和留在身边的实体作品。</p>
      </div>
      <nav aria-label="页脚导航">
        <div>
          <strong>了解哞屋</strong>
          <RouterLink to="/about">品牌故事</RouterLink>
          <RouterLink to="/products">产品介绍</RouterLink>
          <RouterLink to="/faq">常见问题</RouterLink>
        </div>
        <div>
          <strong>开始使用</strong>
          <RouterLink to="/showcase">联名商品</RouterLink>
          <RouterLink to="/customize">私人定制</RouterLink>
          <RouterLink to="/contact">联络我们</RouterLink>
        </div>
        <div>
          <strong>规则说明</strong>
          <RouterLink to="/legal/privacy">隐私政策</RouterLink>
          <RouterLink to="/legal/terms">用户协议</RouterLink>
          <span>当前尚未公开上线</span>
        </div>
      </nav>
    </div>
    <div class="site-footer__bottom">
      <span>© {{ new Date().getFullYear() }} 哞屋 MOWO</span>
      <span>测试阶段 · 不构成正式交易承诺</span>
    </div>
  </footer>
</template>
