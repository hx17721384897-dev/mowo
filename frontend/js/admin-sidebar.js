// js/admin-sidebar.js
// 统一管理后台左侧菜单（可折叠分组）
// 用法：页面里放 <aside class="sidebar" id="sidebar"></aside>，再引入本脚本

(function () {
  // 菜单定义：按类别分组，每组一个可展开按钮
  // 订单阶段已由 Vue 接管；尚未迁移的生产页面通过绝对应用地址进入同一订单工作台。
  const MENU = [
    {
      key: 'production', label: '生产', icon: '📦',
      items: [
        {
          key: 'orders', icon: '📋', label: '全部订单',
          children: [
            { href: `${window.MOWO_APP_BASE || '/app'}/admin/orders`,                 icon: '▦', label: '订单总览' },
            { href: `${window.MOWO_APP_BASE || '/app'}/admin/orders?view=paid`,       icon: '○', label: '已付款' },
            { href: `${window.MOWO_APP_BASE || '/app'}/admin/orders?view=pending`,    icon: '↓', label: '待处理' },
            { href: `${window.MOWO_APP_BASE || '/app'}/admin/orders?view=locked`,     icon: '⌁', label: '处理中' },
            { href: `${window.MOWO_APP_BASE || '/app'}/admin/orders?view=processing`, icon: '□', label: '待生产' },
            { href: `${window.MOWO_APP_BASE || '/app'}/admin/orders?view=producing`,  icon: '↻', label: '生产中' },
            { href: `${window.MOWO_APP_BASE || '/app'}/admin/orders?view=ready`,      icon: '✓', label: '待发货' },
            { href: `${window.MOWO_APP_BASE || '/app'}/admin/orders?view=shipped`,    icon: '→', label: '已发货' }
          ]
        },
        { href: `${window.MOWO_APP_BASE || '/app'}/admin/production-batches`, icon: '▦', label: '生产批次' },
        {
          key: 'scan', icon: '⌁', label: '扫码作业',
          children: [
            { href: 'production-scan.html?v=20260904-1#overview', icon: '▦', label: '作业总览', station: 'overview' },
            { href: 'production-scan.html?v=20260904-1#frame',    icon: '1', label: '帧包完成', station: 'frame' },
            { href: 'production-scan.html?v=20260904-1#material', icon: '2', label: '材料领用', station: 'material' },
            { href: 'production-scan.html?v=20260904-1#pairing',  icon: '3', label: '单件配对', station: 'pairing' },
            { href: 'production-scan.html?v=20260904-1#packing',  icon: '4', label: '装箱发货', station: 'packing' }
          ]
        },
        { href: 'admin-print-production.html',         icon: '↕', label: '打印与裁切设置' },
        { href: `${window.MOWO_APP_BASE || '/app'}/admin/import`, icon: '📥', label: '外部订单导入' }
      ]
    },
    {
      key: 'assets', label: '素材', icon: '🖼',
      items: [
        { href: `${window.MOWO_APP_BASE || '/app'}/admin/frame-library`, icon: '▦', label: '帧图资产库' },
        { href: `${window.MOWO_APP_BASE || '/app'}/admin/frame-making`, icon: '✂', label: '帧图制作' },
        { href: `${window.MOWO_APP_BASE || '/app'}/admin/frame-imports`, icon: '⇧', label: '批量导入' }
      ]
    },
    {
      key: 'product', label: '商品', icon: '🎯',
      items: [
        { href: `${window.MOWO_APP_BASE || '/app'}/admin/models`, icon: '🧩', label: '款式管理' },
        { href: 'admin-inventory.html', icon: '📊', label: '库存管理' }
      ]
    },
    {
      key: 'customization', label: '定制', icon: '✂',
      items: [
        { href: `${window.MOWO_APP_BASE || '/app'}/admin/customization-requests`, icon: '☷', label: '定制处理' }
      ]
    },
    {
      key: 'collab', label: '联名', icon: '🤝',
      items: [
        { href: `${window.MOWO_APP_BASE || '/app'}/admin/collab-works`, icon: '🎨', label: '联名作品' }
      ]
    },
    {
      key: 'ops', label: '运营', icon: '💌',
      items: [
        { href: `${window.MOWO_APP_BASE || '/app'}/admin/contact`, icon: '📨', label: '联络留言' }
      ]
    },
    {
      key: 'users', label: '用户', icon: '👥',
      items: [
        { href: 'admin-users.html', icon: '👤', label: '用户列表' },
        { href: 'admin-account-deletions.html', icon: '⚠', label: '注销任务' }
      ]
    },
    {
      key: 'system', label: '系统', icon: '⚙️',
      items: [
        { href: 'admin-logs.html', icon: '📋', label: '审计日志' }
      ]
    }
  ];

  const STAFF_GROUPS = {
    OWNER: ['production', 'assets', 'customization', 'product', 'collab', 'ops', 'users', 'system'],
    CUSTOMER_SERVICE: ['customization', 'product', 'ops', 'users'],
    PRODUCTION: ['production', 'assets', 'customization', 'product'],
    COLLAB_OPS: ['assets', 'collab']
  };

  const STAFF_HIDDEN_ITEMS = {
    CUSTOMER_SERVICE: new Set(['admin-inventory.html', 'admin-print-production.html']),
    PRODUCTION: new Set([`${window.MOWO_APP_BASE || '/app'}/admin/models`, `${window.MOWO_APP_BASE || '/app'}/admin/frame-imports`, 'admin-print-production.html']),
    COLLAB_OPS: new Set([`${window.MOWO_APP_BASE || '/app'}/admin/frame-making`, `${window.MOWO_APP_BASE || '/app'}/admin/frame-imports`])
  };

  const CSS = `
.sidebar{width:var(--sidebar-w,220px);min-height:100vh;background:var(--black,#111110);display:flex;flex-direction:column;position:fixed;left:0;top:0;bottom:0;z-index:100;transition:width .3s cubic-bezier(0.22,1,0.36,1);overflow:hidden;}
.sidebar.collapsed{width:var(--sidebar-collapsed,60px);}
.sidebar-logo{padding:24px 20px 20px;border-bottom:1px solid rgba(255,255,255,.08);display:flex;align-items:center;gap:10px;white-space:nowrap;overflow:hidden;}
.sidebar-logo-icon{width:32px;height:32px;background:var(--accent-y,#F5E642);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;}
.sidebar-logo-text{font-weight:900;font-size:15px;color:var(--white,#fff);letter-spacing:.04em;}
.sidebar-logo-sub{font-weight:700;font-size:10px;color:var(--gray3,#787874);letter-spacing:.1em;text-transform:uppercase;display:block;margin-top:1px;}
.sidebar-toggle{position:absolute;top:26px;right:12px;width:28px;height:28px;background:rgba(255,255,255,.08);border:none;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--gray3,#787874);font-size:12px;transition:background .2s;}
.sidebar-toggle:hover{background:rgba(255,255,255,.15);color:var(--white,#fff);}
.sidebar-nav{flex:1;padding:12px 0;overflow-y:auto;overflow-x:hidden;scrollbar-width:none;-ms-overflow-style:none;}
.sidebar-nav::-webkit-scrollbar{display:none;}
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
.nav-sub.open{max-height:720px;}
.sidebar.collapsed .nav-sub{max-height:0;}
.nav-sub-item{display:flex;align-items:center;gap:8px;padding:8px 20px 8px 44px;cursor:pointer;transition:background .15s;white-space:nowrap;overflow:hidden;color:var(--gray3,#787874);font-weight:700;font-size:12.5px;text-decoration:none;position:relative;}
.nav-sub-item:hover{background:rgba(255,255,255,.06);color:var(--white,#fff);}
.sidebar .nav-sub-item.active{color:var(--accent-y,#F5E642) !important;background:rgba(245,230,66,.12) !important;font-weight:800;}
.sidebar .nav-sub-item.active::before{content:'' !important;position:absolute !important;left:0 !important;top:0 !important;bottom:0 !important;width:3px !important;height:auto !important;transform:none !important;background:var(--accent-y,#F5E642) !important;border-radius:0 2px 2px 0 !important;}
.nav-sub-item .nav-icon{font-size:13px;width:16px;}
.nav-sub-parent{display:flex;align-items:center;gap:8px;width:100%;padding:8px 20px 8px 44px;border:0;background:transparent;cursor:pointer;color:var(--gray3,#787874);font:inherit;font-weight:700;font-size:12.5px;text-align:left;white-space:nowrap;overflow:hidden;transition:background .15s,color .15s;}
.nav-sub-parent:hover{background:rgba(255,255,255,.06);color:var(--white,#fff);}
.nav-sub-parent.active-parent{color:var(--accent-y,#F5E642);}
.nav-sub-parent .nav-icon{font-size:13px;width:16px;}
.nav-third-arrow{margin-left:auto;font-size:9px;opacity:.6;transition:transform .2s;}
.nav-sub-parent.open .nav-third-arrow{transform:rotate(180deg);opacity:1;}
.nav-third{max-height:0;overflow:hidden;transition:max-height .25s ease;background:rgba(255,255,255,.018);}
.nav-third.open{max-height:420px;}
.sidebar.collapsed .nav-third{max-height:0;}
.nav-third-item{display:flex;align-items:center;gap:8px;padding:7px 18px 7px 64px;color:var(--gray3,#787874);font-weight:700;font-size:11.5px;text-decoration:none;white-space:nowrap;overflow:hidden;position:relative;transition:background .15s,color .15s;}
.nav-third-item:hover{background:rgba(255,255,255,.06);color:var(--white,#fff);}
.nav-third-item .nav-icon{width:14px;font-size:11px;}
.sidebar .nav-third-item.active{color:var(--accent-y,#F5E642);background:rgba(245,230,66,.12);font-weight:800;}
.sidebar .nav-third-item.active::before{content:'';position:absolute;left:28px;top:10px;width:5px;height:5px;border-radius:50%;background:var(--accent-y,#F5E642);}
.nav-third-item[class*="station-"] .nav-icon{height:18px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-weight:900;}
.nav-third-item.station-overview .nav-icon{background:#f5e642;color:#111;}
.nav-third-item.station-frame .nav-icon{background:#2f73c9;color:#fff;}
.nav-third-item.station-material .nav-icon{background:#c76518;color:#fff;}
.nav-third-item.station-pairing .nav-icon{background:#168b86;color:#fff;}
.nav-third-item.station-packing .nav-icon{background:#2b7d46;color:#fff;}
.sidebar-back{display:flex;align-items:center;gap:10px;padding:12px 20px;border-top:1px solid rgba(255,255,255,.08);color:var(--gray3,#787874);font-weight:800;font-size:13px;text-decoration:none;white-space:nowrap;overflow:hidden;transition:background .15s,color .15s;flex-shrink:0;}
.sidebar-back:hover{background:rgba(255,255,255,.06);color:var(--white,#fff);}
.sidebar.collapsed .sidebar-back .nav-label{opacity:0;}
.sidebar-footer{padding:16px 20px;border-top:1px solid rgba(255,255,255,.08);white-space:nowrap;overflow:hidden;}
.sidebar-user{display:flex;align-items:center;gap:10px;}
.sidebar-user-avatar{width:32px;height:32px;border-radius:50%;background:var(--accent-y,#F5E642);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:13px;color:var(--black,#111110);flex-shrink:0;}
.sidebar-user-name{font-weight:800;font-size:12px;color:var(--white,#fff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.sidebar-user-role{font-weight:700;font-size:10px;color:var(--gray3,#787874);}
.sidebar.collapsed .sidebar-user-info{display:none;}
@media(max-width:1023px){
  .sidebar{
    z-index:200;
    width:min(var(--sidebar-w,220px),calc(100vw - 48px));
    height:100vh;
    height:100dvh;
    min-height:0;
  }
  .sidebar.collapsed{width:min(var(--sidebar-w,220px),calc(100vw - 48px));}
  .sidebar.collapsed .nav-label,.sidebar.collapsed .nav-group-arrow{opacity:1;}
  .sidebar.collapsed .sidebar-user-info{display:block;}
  .sidebar-nav{min-height:0;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;}
}
`;

  function currentFile() {
    const p = location.pathname.split('/').pop() || '';
    const q = location.search;
    let combined = (p + q).toLowerCase();
    return combined;
  }

  function itemIsActive(item, target) {
    if (item.href && item.href.toLowerCase() === target) return true;
    return Array.isArray(item.children) && item.children.some(child => itemIsActive(child, target));
  }

  function filterVisibleItem(item, hiddenItems, features) {
    if (Array.isArray(item.children)) {
      const children = item.children
        .map(child => filterVisibleItem(child, hiddenItems, features))
        .filter(Boolean);
      return children.length ? { ...item, children } : null;
    }
    if (!item.href || hiddenItems.has(item.href.split('?')[0])) return null;
    if (item.feature && !features[item.feature]) return null;
    return item;
  }

  function nestedOpenKey(groupKey, itemKey) {
    return `${groupKey}:${itemKey}`;
  }

  // 供页面调用：切换视图后更新侧边栏高亮，避免整页刷新
  window.__adminSidebarSetActive = function(href) {
    const target = href.toLowerCase();
    document.querySelectorAll('.nav-sub-item, .nav-third-item').forEach(el => {
      el.classList.toggle('active', (el.getAttribute('href') || '').toLowerCase() === target);
    });
    // 同步父组标题高亮
    document.querySelectorAll('.nav-group').forEach(g => {
      const hasActive = g.querySelector('.nav-sub-item.active, .nav-third-item.active');
      g.querySelector('.nav-group-header')?.classList.toggle('active-group', !!hasActive);
      if (hasActive) {
        g.querySelector('.nav-group-header')?.classList.add('open');
        g.querySelector('.nav-sub')?.classList.add('open');
      }
    });
    document.querySelectorAll('.nav-sub-parent').forEach(parent => {
      const wrapper = parent.closest('.nav-nested');
      const hasActive = !!wrapper?.querySelector('.nav-third-item.active');
      parent.classList.toggle('active-parent', hasActive);
      if (hasActive) {
        parent.classList.add('open');
        wrapper.querySelector('.nav-third')?.classList.add('open');
        const set = getOpenSet() || new Set();
        set.add(parent.dataset.openKey);
        const groupKey = parent.closest('.nav-group')?.dataset.key;
        if (groupKey) set.add(groupKey);
        saveOpenSet(set);
      }
    });
  };

  const OPEN_KEY = 'mowo_admin_sidebar_open';

  // 页面自己的 DOMContentLoaded 处理可能早于异步菜单渲染。
  // 先同步放入稳定的菜单骨架，避免旧页面找不到用户信息元素后误判为无权限。
  function ensureSidebarShell() {
    const root = document.getElementById('sidebar');
    if (!root) return;
    if (!document.getElementById('admin-sidebar-css')) {
      const s = document.createElement('style');
      s.id = 'admin-sidebar-css';
      s.textContent = CSS;
      document.head.appendChild(s);
    }
    if (document.getElementById('sidebarName')) return;
    root.innerHTML = `
<div class="sidebar-logo">
  <div class="sidebar-logo-icon">🐄</div>
  <div><div class="sidebar-logo-text">哞屋后台</div><span class="sidebar-logo-sub">MOWO Admin</span></div>
</div>
<nav class="sidebar-nav"></nav>
<a class="sidebar-back" href="index.html"><span class="nav-icon">🌐</span><span class="nav-label">返回前台</span></a>
<div class="sidebar-footer">
  <div class="sidebar-user">
    <div class="sidebar-user-avatar" id="sidebarAvatar">管</div>
    <div class="sidebar-user-info">
      <div class="sidebar-user-name" id="sidebarName">加载中…</div>
      <div class="sidebar-user-role" id="sidebarRole">—</div>
    </div>
  </div>
</div>`;
  }

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

  async function render() {
    const root = document.getElementById('sidebar');
    if (!root) return;

    // 注入样式（只注入一次）
    if (!document.getElementById('admin-sidebar-css')) {
      const s = document.createElement('style');
      s.id = 'admin-sidebar-css';
      s.textContent = CSS;
      document.head.appendChild(s);
    }

    let currentUser = null;
    try {
      currentUser = typeof window.fetchCurrentUser === 'function'
        ? await window.fetchCurrentUser()
        : JSON.parse(localStorage.getItem('mowo_user') || 'null');
    } catch (_) {}
    const staffRole = currentUser?.staffRole || null;
    let features = {};
    try {
      features = typeof window.getMowoFeatureFlags === 'function'
        ? await window.getMowoFeatureFlags()
        : await fetch(`${window.MOWO_API_BASE || ''}/api/config/features`)
            .then(res => res.json()).then(json => json.data || {});
    } catch (_) {}
    const allowedGroups = new Set(STAFF_GROUPS[staffRole] || []);
    const hiddenItems = STAFF_HIDDEN_ITEMS[staffRole] || new Set();
    const visibleMenu = MENU
      .filter(group => allowedGroups.has(group.key))
      .map(group => ({
        ...group,
        items: group.items
          .map(item => filterVisibleItem(item, hiddenItems, features))
          .filter(Boolean)
      }))
      .filter(group => group.items.length > 0);
    const curFile = currentFile();
    let openSet = getOpenSet();
    // 首次访问：默认展开当前页所在组
    if (!openSet) {
      openSet = new Set();
      visibleMenu.forEach(g => {
        if (g.items.some(it => itemIsActive(it, curFile))) openSet.add(g.key);
        g.items.forEach(it => {
          if (it.children?.some(child => itemIsActive(child, curFile))) openSet.add(nestedOpenKey(g.key, it.key));
        });
      });
      saveOpenSet(openSet);
    } else {
      // 保证当前页所在组始终展开（否则用户看不到高亮的子项）
      visibleMenu.forEach(g => {
        if (g.items.some(it => itemIsActive(it, curFile))) openSet.add(g.key);
        g.items.forEach(it => {
          if (it.children?.some(child => itemIsActive(child, curFile))) openSet.add(nestedOpenKey(g.key, it.key));
        });
      });
    }

    // 构建 HTML
    let nav = '';
    visibleMenu.forEach(group => {
      const activeInGroup = group.items.some(it => itemIsActive(it, curFile));
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
      if (Array.isArray(it.children)) {
        const childActive = it.children.some(child => itemIsActive(child, curFile));
        const openKey = nestedOpenKey(group.key, it.key);
        const nestedOpen = openSet.has(openKey);
        return `<div class="nav-nested" data-nested="${openKey}">
          <button class="nav-sub-parent${nestedOpen ? ' open' : ''}${childActive ? ' active-parent' : ''}" type="button" data-open-key="${openKey}" onclick="__adminSidebarToggleNested('${openKey}')">
            <span class="nav-icon">${it.icon}</span><span class="nav-label">${it.label}</span><span class="nav-third-arrow">▾</span>
          </button>
          <div class="nav-third${nestedOpen ? ' open' : ''}">
            ${it.children.map(child => {
              const active = child.href.toLowerCase() === curFile ? ' active' : '';
              return `<a class="nav-third-item${child.station ? ` station-${child.station}` : ''}${active}" href="${child.href}"><span class="nav-icon">${child.icon}</span><span class="nav-label">${child.label}</span></a>`;
            }).join('')}
          </div>
        </div>`;
      }
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
<a class="sidebar-back" href="index.html"><span class="nav-icon">🌐</span><span class="nav-label">返回前台</span></a>
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
    fillUser(currentUser);
  }

  function fillUser(currentUser) {
    try {
      const u = currentUser || JSON.parse(localStorage.getItem('mowo_user') || 'null');
      if (!u) return;
      const name = u.profile?.nickname || u.nickname || u.maskedPhone || '员工';
      const roleMap = { OWNER:'负责人', CUSTOMER_SERVICE:'运营客服', PRODUCTION:'生产人员', COLLAB_OPS:'合作运营' };
      const nameEl = document.getElementById('sidebarName');
      const roleEl = document.getElementById('sidebarRole');
      const avaEl  = document.getElementById('sidebarAvatar');
      if (nameEl) nameEl.textContent = name;
      if (roleEl) roleEl.textContent = roleMap[u.staffRole] ?? '—';
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

  window.__adminSidebarToggleNested = function (key) {
    const root = document.getElementById('sidebar');
    if (!root) return;
    const wrapper = root.querySelector(`.nav-nested[data-nested="${key}"]`);
    const parent = wrapper?.querySelector('.nav-sub-parent');
    const children = wrapper?.querySelector('.nav-third');
    if (!parent || !children) return;
    const nowOpen = !children.classList.contains('open');
    parent.classList.toggle('open', nowOpen);
    children.classList.toggle('open', nowOpen);
    const set = getOpenSet() || new Set();
    if (nowOpen) set.add(key); else set.delete(key);
    saveOpenSet(set);
  };

  ensureSidebarShell();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
