/**
 * MOWO 公共导航栏注入脚本  frontend/js/nav.js
 *
 * 使用方法（所有公共页面）：
 *   <link rel="stylesheet" href="../css/nav.css">
 *   ...在 <body> 最顶部：
 *   <script src="../js/nav.js"></script>
 *   <script src="../js/auth.js"></script>
 *
 * 功能：
 *   - 同步注入 <nav id="mowo-nav">（无闪烁）
 *   - DOMContentLoaded 后注入移动端菜单
 *   - 自动高亮当前页链接
 *   - 暴露 mowoMenuOpen / mowoMenuClose 全局函数
 *   - syncMobileAuth 与 auth.js 状态同步
 */
;(function () {
  /* ── 当前路径判断 ── */
  var p = location.pathname;
  function act(pages) {
    for (var i = 0; i < pages.length; i++) {
      if (p.indexOf(pages[i]) !== -1) return ' class="active"';
    }
    return '';
  }

  /* ── SVG 图标 ── */
  var IC = {
    menu:   '<svg viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18"/></svg>',
    close:  '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    user:   '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>',
    cart:   '<svg viewBox="0 0 24 24"><path d="M3 4h2l2.5 12h11l2.5-9H6"/><circle cx="9" cy="20" r="1.6"/><circle cx="18" cy="20" r="1.6"/></svg>'
  };

  /* ── Nav HTML ── */
  var navHTML = '<nav id="mowo-nav">' +
    '<div class="mowo-nav-left">' +
      '<button class="mowo-menu-btn" onclick="mowoMenuOpen()" aria-label="菜单">' + IC.menu + '</button>' +
      '<a href="index.html" class="mowo-logo">' +
        '<span class="mowo-logo-mark">M</span>' +
        '<span class="mowo-logo-text">MOWOBOX<span class="mowo-logo-sub">哞屋造物</span></span>' +
      '</a>' +
    '</div>' +
    '<div class="mowo-nav-mid">' +
      '<a href="about.html"' + act(['about']) + '>关于我们</a>' +
      '<a href="products.html"' + act(['products']) + '>动盒系列</a>' +
      '<a href="showcase.html"' + act(['showcase', 'community']) + '>创意社区</a>' +
      '<a href="customize-start.html"' + act(['customize', 'creator']) + '>创作中心</a>' +
      '<a href="contact.html"' + act(['contact']) + '>联络我们</a>' +
    '</div>' +
    '<div class="mowo-nav-right">' +
      '<a class="mowo-nav-icon" href="showcase.html" aria-label="搜索">' + IC.search + '</a>' +
      '<a class="mowo-nav-icon mowo-cart-btn" href="cart.html" data-count="0" aria-label="购物车">' + IC.cart + '</a>' +
      /* auth.js 会在 #navLoginBtn 之前插入 .nav-user 头像区，头像始终在最右 */
      '<button class="mowo-nav-icon nav-login-btn" id="navLoginBtn" aria-label="登录 / 个人中心">' + IC.user + '</button>' +
    '</div>' +
  '</nav>';

  /* ── 同步注入到 <script> 标签之前 ── */
  var s = document.currentScript;
  var tmp = document.createElement('div');
  tmp.innerHTML = navHTML;
  s.parentNode.insertBefore(tmp.firstChild, s);

  /* ── 移动菜单（DOMContentLoaded 后注入，默认隐藏，无 FOUC 问题） ── */
  document.addEventListener('DOMContentLoaded', function () {
    if (document.getElementById('mowo-mobile-menu')) return;

    var mobileHTML = '<div id="mowo-mobile-menu" class="mowo-mobile-menu">' +
      '<div class="mowo-mobile-head">' +
        '<a href="index.html" class="mowo-logo">' +
          '<span class="mowo-logo-mark">M</span>' +
          '<span class="mowo-logo-text">MOWOBOX</span>' +
        '</a>' +
        '<button class="mowo-mobile-close" onclick="mowoMenuClose()" aria-label="关闭">' + IC.close + '</button>' +
      '</div>' +
      '<div class="mowo-mobile-body">' +
        '<a href="about.html"' + act(['about']) + '>关于我们</a>' +
        '<a href="products.html"' + act(['products']) + '>动盒系列</a>' +
        '<a href="showcase.html"' + act(['showcase', 'community']) + '>创意社区</a>' +
        '<a href="customize-start.html"' + act(['customize', 'creator']) + '>创作中心</a>' +
        '<a href="contact.html"' + act(['contact']) + '>联络我们</a>' +
        '<a href="cart.html">购物车</a>' +
        '<a href="orders.html">我的订单</a>' +
        '<a href="settings.html">账号设置</a>' +
      '</div>' +
      '<div class="mowo-mobile-foot">' +
        '<button id="mobileLoginBtn">登录 / 注册</button>' +
        '<div id="mobileMenuAvatar" class="mowo-mobile-avatar">' +
          '<div id="mobileMenuAvatarBtn" class="mowo-mobile-avatar-img">U</div>' +
          '<div id="mobileMenuAvatarName" class="mowo-mobile-avatar-name">用户</div>' +
        '</div>' +
      '</div>' +
    '</div>';

    document.body.insertAdjacentHTML('beforeend', mobileHTML);

    /* 移动端登录按钮点 → 触发桌面登录弹窗 */
    var mBtn = document.getElementById('mobileLoginBtn');
    var dBtn = document.getElementById('navLoginBtn');
    if (mBtn && dBtn) {
      mBtn.addEventListener('click', function () {
        mowoMenuClose();
        setTimeout(function () { dBtn.click(); }, 200);
      });
    }

    /* 与 auth.js 状态同步 */
    _mowoSyncMobileAuth();
  });

  /* ── 移动菜单 auth 同步 ── */
  function _mowoSyncMobileAuth() {
    var navBtn    = document.getElementById('navLoginBtn');
    var mobileAvatar = document.getElementById('mobileMenuAvatar');
    var mobileAvatarBtn  = document.getElementById('mobileMenuAvatarBtn');
    var mobileAvatarName = document.getElementById('mobileMenuAvatarName');
    if (!navBtn || !mobileAvatar) return;

    function sync() {
      var userInfo = localStorage.getItem('mowo_user');
      var navUserVisible = document.getElementById('mowoNavUser') &&
        document.getElementById('mowoNavUser').classList.contains('show');
      if (userInfo || navUserVisible) {
        document.getElementById('mobileLoginBtn').style.display = 'none';
        mobileAvatar.classList.add('show');
        try {
          var u = JSON.parse(userInfo || '{}');
          var name = (u.profile && u.profile.nickname) || u.phone || '用户';
          mobileAvatarName.textContent = name;
          mobileAvatarBtn.textContent = (name[0] || 'U').toUpperCase();
        } catch (e) {}
      } else {
        document.getElementById('mobileLoginBtn').style.display = '';
        mobileAvatar.classList.remove('show');
      }
    }

    sync();
    /* 监听 auth.js 注入的 .nav-user 状态变化 */
    var observer = new MutationObserver(sync);
    var target = document.getElementById('mowoNavUser');
    if (target) observer.observe(target, { attributes: true, attributeFilter: ['class'] });
    /* 也监听 localStorage 变化（跨标签页登录/登出） */
    window.addEventListener('storage', sync);
    window.addEventListener('mowoTokenRefreshed', sync);
  }

  /* ── 全局暴露 ── */
  window.mowoMenuOpen = function () {
    var m = document.getElementById('mowo-mobile-menu');
    if (m) { m.classList.add('open'); document.body.style.overflow = 'hidden'; }
  };
  window.mowoMenuClose = function () {
    var m = document.getElementById('mowo-mobile-menu');
    if (m) { m.classList.remove('open'); document.body.style.overflow = ''; }
  };

})();
