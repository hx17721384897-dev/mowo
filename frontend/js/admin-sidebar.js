// js/admin-sidebar.js
// 统一管理后台左侧菜单（可折叠分组）
// 用法：页面里放 <aside class="sidebar" id="sidebar"></aside>，再引入本脚本

(function () {
  // 菜单定义：按类别分组，每组一个可展开按钮
  // 默认入口仍是 admin-orders.html（生产 > 定制订单）
  const MENU = [
    {
      key: 'production', label: '生产', icon: '📦',
      items: [
        { href: 'admin-orders.html', icon: '🧾', label: '定制订单' },
        { href: 'admin-import.html',  icon: '📥', label: '定制导入' }
      ]
    },
    {
      key: 'product', label: '商品', icon: '🎯',
      items: [
        { href: 'admin-models.html',    icon: '🧩', label: '款式管理' },
        { href: 'admin-inventory.html', icon: '📊', label: '库存管理' }
      ]
    },
    {
      key: 'collab', label: '联名', icon: '🤝',
      items: [
        { href: 'admin-collab-works.html',      icon: '🎨', label: '联名作品' },
        { href: 'admin-collab.html',            icon: '✅', label: '联名审核' },
        { href: 'admin-collab-activities.html', icon: '🎪', label: '活动管理' },
        { href: 'admin-contract.html',          icon: '📑', label: '商务合同' }
      ]
    },
    {
      key: 'creator', label: '创作者', icon: '🐄',
      items: [
        { href: 'admin-settlement.html', icon: '💰', label: '结算管理' },
        { href: 'admin-bull.html',       icon: '📈', label: '牛量管理' },
        { href: 'admin-links.html',      icon: '🔗', label: '引流链接' }
      ]
    },
    {
      key: 'ops', label: '运营', icon: '💌',
      items: [
        { href: 'admin-contact.html', icon: '📨', label: '联络留言' }
      ]
    },
    {
      key: 'users', label: '用户', icon: '👥',
      items: [
        { href: 'admin-users.html', icon: '👤', label: '用户列表' }
      ]
    },
    {
      key: 'system', label: '系统', icon: '⚙️',
      items: [
        { href: 'admin-logs.html', icon: '📋', label: '审计日志' },
        { href: 'index.html',      icon: '🌐', label: '返回前台' }
      ]
    }
  ];

  const CSS = `
.sidebar{width:var(--sidebar-w,220px);min-height:100vh;background:var(--black,#111110);display:flex;flex-direction:column;position:fixed;left:0;top:0;bottom:0;z-index:100;transition:width .3s cubic-bezier(0.22,1,0.36,1);overflow:hidden;}
.sidebar.collapsed{width:var(--sidebar-collapsed,60px);}
.sidebar-logo{padding:24px 20px 20px;border-bottom:1px solid rgba(255,255,255,.08);display:flex;align-items:center;gap:10px;white-space:nowrap;overflow:hidden;}
.sidebar-logo-icon{width:32px;height:32px;background:var(--accent-y,#F5E642);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;}
.sidebar-logo-text{font-weight:900;font-size:15px;color:var(--white,#fff);letter-spacing:.04em;}
.sidebar-logo-sub{font-weight:700;font-size:10px;color:var(--gray3,#787874);letter-spacing:.1em;text-transform:uppercase;display:block;margin-top:1px;}
.sidebar-toggle{position:absolute;top:26px;right:12px;width:28px;height:28px;background:rgba(255,255,255,.08);border:none;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--gray3,#787874);font-size:12px;transition:background .2s;}
.sidebar-toggle:hover{background:rgba(255,255,255,.15);color:var(--white,#fff);}
.sidebar-nav{flex:1;padding:12px 0;overflow-y:auto;overflow-x:hidden;}
.sidebar-nav::-webkit-scrollbar{width:4px;}
.sidebar-nav::-webkit-scrollbar-thumb{background:rgba(255,255,255,.08);border-radius:2px;}
.nav-group-header{display:flex;align-items:center;gap:10px;padding:10px 20px;cursor:pointer;transition:background .15s;white-space:nowrap;overflow:hidden;color:var(--gray3,#787874);font-weight:800;font-size:13px;position:relative;user-select:none;}
.nav-group-header:hover{background:rgba(255,255,255,.06);color:var(--white,#fff);}
.nav-group-header.open{color:var(--white,#fff);}
.nav-group-header.active-group{color:var(--accent-y,#F5E642);}
.nav-icon{font-size:16px;flex-shrink:0;width:20px;text-align:center;}
.nav-label{transition:opacity .2s;}
.sidebar.collapsed .nav-label{opacity:0;}
.nav-group-arrow{margin-left:auto;font-size:10px;transition:transform .2s;flex-shrink:0;opacity:.6;}
.nav-group-header.open .nav-group-arrow{transform:rotate(180deg);opacity:1;}
.sidebar.collapsed .nav-group-arrow{opacity:0;}
.nav-sub{max-height:0;overflow:hidden;transition:max-height .3s ease;}
.nav-sub.open{max-height:500px;}
.sidebar.collapsed .nav-sub{max-height:0;}
.nav-sub-item{display:flex;align-items:center;gap:8px;padding:8px 20px 8px 44px;cursor:pointer;transition:background .15s;white-space:nowrap;overflow:hidden;color:var(--gray3,#787874);font-weight:700;font-size:12.5px;text-decoration:none;position:relative;}
.nav-sub-item:hover{background:rgba(255,255,255,.06);color:var(--white,#fff);}
.sidebar .nav-sub-item.active{color:var(--accent-y,#F5E642) !important;background:rgba(245,230,66,.12) !important;font-weight:800;}
.sidebar .nav-sub-item.active::before{content:'' !important;position:absolute !important;left:0 !important;top:0 !important;bottom:0 !important;width:3px !important;height:auto !important;transform:none !important;background:var(--accent-y,#F5E642) !important;border-radius:0 2px 2px 0 !important;}
.nav-sub-item .nav-icon{font-size:13px;width:16px;}
.sidebar-footer{padding:16px 20px;border-top:1px solid rgba(255,255,255,.08);white-space:nowrap;overflow:hidden;}
.sidebar-user{display:flex;align-items:center;gap:10px;}
.sidebar-user-avatar{width:32px;height:32px;border-radius:50%;background:var(--accent-y,#F5E642);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:13px;color:var(--black,#111110);flex-shrink:0;}
.sidebar-user-name{font-weight:800;font-size:12px;color:var(--white,#fff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.sidebar-user-role{font-weight:700;font-size:10px;color:var(--gray3,#787874);}
.sidebar.collapsed .sidebar-user-info{display:none;}
`;

  function currentFile() {
    const p = location.pathname.split('/').pop() || '';
    return p.toLowerCase();
  }

  const OPEN_KEY = 'mowo_admin_sidebar_open';
  function getOpenSet() {
    try {
      const raw = localStorage.getItem(OPEN_KEY);
      if (raw) return new Set(JSON.parse(raw));
    } catch(_){}
    return null;
  }
  function saveOpenSet(set) {
    try { localStorage.setItem(OPEN_KEY, JSON.stringify([...set])); } catch(_){}
  }

  function render() {
    const root = document.getElementById('sidebar');
    if (!root) return;

    // 注入样式（只注入一次）
    if (!document.getElementById('admin-sidebar-css')) {
      const s = document.createElement('style');
      s.id = 'admin-sidebar-css';
      s.textContent = CSS;
      document.head.appendChild(s);
    }

    const curFile = currentFile();
    let openSet = getOpenSet();
    // 首次访问：默认展开当前页所在组
    if (!openSet) {
      openSet = new Set();
      MENU.forEach(g => {
        if (g.items.some(it => it.href.toLowerCase() === curFile)) openSet.add(g.key);
      });
      saveOpenSet(openSet);
    } else {
      // 保证当前页所在组始终展开（否则用户看不到高亮的子项）
      MENU.forEach(g => {
        if (g.items.some(it => it.href.toLowerCase() === curFile)) openSet.add(g.key);
      });
    }

    // 构建 HTML
    let nav = '';
    MENU.forEach(group => {
      const activeInGroup = group.items.some(it => it.href.toLowerCase() === curFile);
      const isOpen = openSet.has(group.key);
      const openCls = (isOpen ? ' open' : '') + (activeInGroup ? ' active-group' : '');
      const subOpen = isOpen ? ' open' : '';
      nav += `
<div class="nav-group" data-key="${group.key}">
  <div class="nav-group-header${openCls}" onclick="__adminSidebarToggleGroup('${group.key}')">
    <span class="nav-icon">${group.icon}</span>
    <span class="nav-label">${group.label}</span>
    <span class="nav-group-arrow">▾</span>
  </div>
  <div class="nav-sub${subOpen}" data-sub="${group.key}">
    ${group.items.map(it => {
      const active = it.href.toLowerCase() === curFile ? ' active' : '';
      return `<a class="nav-sub-item${active}" href="${it.href}"><span class="nav-icon">${it.icon}</span><span class="nav-label">${it.label}</span></a>`;
    }).join('')}
  </div>
</div>`;
    });

    root.innerHTML = `
<div class="sidebar-logo">
  <div class="sidebar-logo-icon">🐄</div>
  <div>
    <div class="sidebar-logo-text">哞屋后台</div>
    <span class="sidebar-logo-sub">MOWO Admin</span>
  </div>
</div>
<button class="sidebar-toggle" id="sidebarToggle" title="折叠菜单">◀</button>
<nav class="sidebar-nav">${nav}</nav>
<div class="sidebar-footer">
  <div class="sidebar-user">
    <div class="sidebar-user-avatar" id="sidebarAvatar">管</div>
    <div class="sidebar-user-info">
      <div class="sidebar-user-name" id="sidebarName">加载中…</div>
      <div class="sidebar-user-role" id="sidebarRole">—</div>
    </div>
  </div>
</div>`;

    // 折叠按钮
    const toggleBtn = document.getElementById('sidebarToggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        root.classList.toggle('collapsed');
        const main = document.getElementById('main') || document.querySelector('.main');
        if (main) main.classList.toggle('expanded');
        try { localStorage.setItem('mowo_admin_sidebar_collapsed', root.classList.contains('collapsed') ? '1' : '0'); } catch(_){}
      });
    }
    // 恢复折叠状态
    try {
      if (localStorage.getItem('mowo_admin_sidebar_collapsed') === '1') {
        root.classList.add('collapsed');
        const main = document.getElementById('main') || document.querySelector('.main');
        if (main) main.classList.add('expanded');
      }
    } catch(_){}

    // 填充用户信息
    fillUser();
  }

  function fillUser() {
    try {
      const raw = localStorage.getItem('mowo_user');
      if (!raw) return;
      const u = JSON.parse(raw);
      const name = u.nickname || u.phone || '管理员';
      const role = u.role;
      const roleMap = { 3: '超级管理员', 2: '管理员', 1: '生产端', 0: '用户' };
      const nameEl = document.getElementById('sidebarName');
      const roleEl = document.getElementById('sidebarRole');
      const avaEl  = document.getElementById('sidebarAvatar');
      if (nameEl) nameEl.textContent = name;
      if (roleEl) roleEl.textContent = roleMap[role] ?? '—';
      if (avaEl)  avaEl.textContent  = (name[0] || '管').toUpperCase();
    } catch(_){}
  }

  // 点击类别按钮：仅切换该组自身，允许多个类别同时展开，状态持久化到 localStorage
  window.__adminSidebarToggleGroup = function (key) {
    const root = document.getElementById('sidebar');
    if (!root) return;
    const targetHeader = root.querySelector(`.nav-group[data-key="${key}"] .nav-group-header`);
    const targetSub    = root.querySelector(`.nav-sub[data-sub="${key}"]`);
    if (!targetHeader || !targetSub) return;
    const nowOpen = !targetSub.classList.contains('open');
    targetHeader.classList.toggle('open', nowOpen);
    targetSub.classList.toggle('open', nowOpen);
    const set = getOpenSet() || new Set();
    if (nowOpen) set.add(key); else set.delete(key);
    saveOpenSet(set);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
