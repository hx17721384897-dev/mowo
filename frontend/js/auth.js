// js/auth.js
// 所有页面共用：登录弹窗 + 导航栏状态管理 + 下拉菜单
// 每个页面在 </body> 前引入：<script src="../js/auth.js"></script>

var MOWO_API_BASE = (location.hostname==='127.0.0.1' ? 'http://127.0.0.1:3001' : 'http://localhost:3001');
const TOKEN_KEY = 'mowo_token';
const USER_KEY  = 'mowo_user';

/* ─────────────────────────────────────────
   Token 工具
───────────────────────────────────────── */
function getToken()    { return localStorage.getItem(TOKEN_KEY); }
function removeToken() {
  clearTimeout(_proactiveRefreshTimer);
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

function clearLocalSession() {
  removeToken();
  updateNavState(null);
}

/* 主动刷新定时器：在 AccessToken 过期前 2 分钟静默刷新，避免 401 */
var _proactiveRefreshTimer = null;
var _logoutInProgress = false;
function _scheduleProactiveRefresh(token) {
  clearTimeout(_proactiveRefreshTimer);
  try {
    const exp = JSON.parse(atob(token.split('.')[1])).exp;
    const delay = exp * 1000 - Date.now() - 2 * 60 * 1000; // 过期前 2 分钟
    if (delay > 0) {
      _proactiveRefreshTimer = setTimeout(() => refreshAccessToken(), delay);
    }
  } catch(_) {}
}

function setToken(t) {
  _logoutInProgress = false;
  localStorage.setItem(TOKEN_KEY, t);
  _scheduleProactiveRefresh(t);
  window.dispatchEvent(new CustomEvent('mowoTokenRefreshed'));
}

/* ─────────────────────────────────────────
   刷新 AccessToken（利用 HttpOnly Cookie 中的 refresh_token）
───────────────────────────────────────── */
async function refreshAccessToken() {
  if (_logoutInProgress) return null;
  try {
    const res = await fetch(`${MOWO_API_BASE}/api/v1/auth/refresh`, {
      method: 'POST',
      credentials: 'include'
    });
    if (!res.ok) return null;
    const json = await res.json();
    const newToken = json.data?.accessToken || json.data?.token;
    if (newToken && !_logoutInProgress) { setToken(newToken); return newToken; }
    return null;
  } catch(_) { return null; }
}

/* ─────────────────────────────────────────
   全局 fetch 拦截器：自动处理 AccessToken 过期
   所有 /api/ 请求如果返回 401，先尝试刷新 Token 再重试一次。
   管理页无需改动各自的 api() 函数即可受益。
───────────────────────────────────────── */
(function patchFetch() {
  const _fetch = window.fetch;
  let _refreshPromise = null;   // 防止并发 401 触发多次刷新

  window.fetch = async function(url, opts) {
    const res = await _fetch(url, opts);

    // 只拦截 API 请求的 401；刷新请求本身不再拦截（防递归）
    const urlStr = String(url);
    const isAuthExitRequest = urlStr.includes('/auth/logout');
    if (res.status !== 401 || !urlStr.includes('/api/') || urlStr.includes('/auth/refresh') || isAuthExitRequest) {
      return res;
    }

    // 并发保护：多个同时 401 只发一次刷新
    if (!_refreshPromise) {
      _refreshPromise = refreshAccessToken().finally(() => { _refreshPromise = null; });
    }
    const newToken = await _refreshPromise;
    if (!newToken) {
      // refresh token 也失效了，清除本地凭证。
      removeToken();
      const isAdminOrCreator = window.location.pathname.includes('admin') || window.location.pathname.includes('creator');
      if (isAdminOrCreator) {
        window.location.href = 'index.html?auth=1';
      }
      return res;
    }

    // 存储新 token，触发 mowoTokenRefreshed 事件，让各页面的 _token 变量同步更新
    setToken(newToken);

    // 用新 token 重试，保留 credentials 确保 Cookie 不丢失
    const newOpts = {
      ...(opts || {}),
      credentials: (opts?.credentials) || 'include',
      headers: { ...(opts?.headers || {}), Authorization: `Bearer ${newToken}` }
    };
    return _fetch(url, newOpts);
  };
})();

/* ─────────────────────────────────────────
   获取当前用户（由服务端确认当前设备会话仍有效）
───────────────────────────────────────── */
async function fetchCurrentUser() {
  const token = getToken();
  if (!token) {
    // 没有 AccessToken，尝试用 RefreshToken Cookie 静默刷新
    const refreshed = await refreshAccessToken();
    if (!refreshed) return null;
  }
  try {
    const currentToken = getToken();
    const res  = await fetch(`${MOWO_API_BASE}/api/v1/account/me`, {
      credentials: 'include',
      headers: { Authorization: `Bearer ${currentToken}` }
    });
    if (res.status === 401) {
      // AccessToken 过期，尝试刷新
      const newToken = await refreshAccessToken();
      if (!newToken) { removeToken(); return null; }
      const res2 = await fetch(`${MOWO_API_BASE}/api/v1/account/me`, {
        credentials: 'include',
        headers: { Authorization: `Bearer ${newToken}` }
      });
      if (!res2.ok) { removeToken(); return null; }
      const json2 = await res2.json();
      localStorage.setItem(USER_KEY, JSON.stringify(json2.data));
      return json2.data;
    }
    if (!res.ok) { removeToken(); return null; }
    const json = await res.json();
    localStorage.setItem(USER_KEY, JSON.stringify(json.data));
    return json.data;
  } catch(e) { return null; }
}

/* ─────────────────────────────────────────
   注入 CSS
───────────────────────────────────────── */
function injectCSS() {
  if (document.getElementById('mowo-auth-style')) return;
  const s = document.createElement('style');
  s.id = 'mowo-auth-style';
  s.textContent = `
/* ── 导航栏用户区域 ── */
.nav-user{position:relative;display:none;}
.nav-user.show{display:block;}
.nav-avatar-btn{display:flex;align-items:center;gap:8px;padding:5px 12px 5px 5px;border-radius:999px;border:2px solid transparent;background:none;cursor:pointer;min-height:44px;transition:border-color .2s,background .2s;font-family:inherit;}
.nav-avatar-btn:hover{border-color:#EBEBEA;background:#fff;}
.nav-avatar-btn.open{border-color:#111110;background:#fff;}
.nav-avatar-circle{width:32px;height:32px;border-radius:50%;overflow:hidden;background:#F5E642;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:13px;color:#111110;flex-shrink:0;border:1.5px solid #EBEBEA;}
.nav-avatar-circle img{width:100%;height:100%;object-fit:cover;}
.nav-uname{font-weight:800;font-size:13px;color:#111110;max-width:72px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:none;}
@media(min-width:640px){.nav-uname{display:block;}}
.nav-chevron{font-size:10px;color:#787874;transition:transform .25s cubic-bezier(.22,1,.36,1);}
.nav-avatar-btn.open .nav-chevron{transform:rotate(180deg);}

/* ── 下拉菜单 ── */
.user-dropdown{position:absolute;top:calc(100% + 10px);right:0;width:200px;background:#fff;border-radius:16px;border:1.5px solid #EBEBEA;box-shadow:0 8px 40px rgba(0,0,0,.12);padding:6px;opacity:0;pointer-events:none;transform:translateY(-8px) scale(.97);transform-origin:top right;transition:opacity .2s,transform .2s;z-index:200;}
.user-dropdown.open{opacity:1;pointer-events:all;transform:none;}

.dd-head{padding:12px 12px 14px;border-bottom:1px solid #EBEBEA;margin-bottom:4px;display:flex;align-items:center;gap:10px;}
.dd-av{width:36px;height:36px;border-radius:50%;background:#F5E642;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:14px;color:#111110;flex-shrink:0;overflow:hidden;border:1.5px solid #EBEBEA;}
.dd-av img{width:100%;height:100%;object-fit:cover;}
.dd-name{font-weight:900;font-size:13px;color:#111110;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:110px;}
.dd-badge{display:inline-block;padding:1px 7px;border-radius:999px;font-size:10px;font-weight:900;}
.dd-badge.creator{background:#EDFBEE;color:#287030;}
.dd-badge.user{background:#EBEBEA;color:#787874;}

.dd-item{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;font-weight:800;font-size:13px;color:#111110;width:100%;text-align:left;background:none;border:none;font-family:inherit;cursor:pointer;transition:background .15s;text-decoration:none;box-sizing:border-box;}
.dd-item:hover{background:#F5F3EF;}
.dd-item-icon{width:26px;height:26px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;}
.dd-item.danger{color:#E03030;}
.dd-item.danger:hover{background:#FFF5F5;}
.dd-divider{height:1px;background:#EBEBEA;margin:4px 0;}
.dd-item.creator-only{display:none;}
.nav-user.is-creator .dd-item.creator-only{display:flex;}
.dd-item.admin-only{display:none;}
.nav-user.is-admin .dd-item.admin-only{display:flex;}
.dd-item.admin-only .dd-item-icon{background:#FFF9C4;}

/* ── 登录弹窗遮罩 ── */
.auth-overlay{position:fixed;inset:0;z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(17,17,16,.45);backdrop-filter:blur(6px);opacity:0;pointer-events:none;transition:opacity .3s cubic-bezier(.22,1,.36,1);}
.auth-overlay.open{opacity:1;pointer-events:all;}

/* ── 登录弹窗 ── */
.auth-box{width:100%;max-width:380px;background:#fff;border-radius:24px;border:1.5px solid #EBEBEA;box-shadow:0 24px 80px rgba(0,0,0,.18);overflow:hidden;transform:translateY(20px) scale(.97);transition:transform .35s cubic-bezier(.22,1,.36,1);position:relative;}
.auth-overlay.open .auth-box{transform:none;}
.auth-box-bar{height:4px;background:linear-gradient(90deg,#F5E642,#FF6B35,#8FD694);}
.auth-box-inner{padding:28px 28px 32px;}
.auth-box-close{position:absolute;top:16px;right:16px;width:30px;height:30px;border-radius:50%;background:#EBEBEA;display:flex;align-items:center;justify-content:center;font-size:14px;color:#787874;cursor:pointer;border:none;transition:background .2s;font-family:inherit;}
.auth-box-close:hover{background:#C4C3BF;color:#111110;}

.auth-box-logo{font-weight:900;font-size:18px;color:#111110;margin-bottom:4px;}
.auth-box-logo-sub{font-size:10px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#787874;}

/* 主Tab：登录/注册 */
.auth-main-tabs{display:flex;gap:0;margin:20px 0 0;border-bottom:2px solid #EBEBEA;}
.auth-main-tab{font-weight:900;font-size:15px;color:#C4C3BF;padding:6px 20px 10px;border-bottom:2.5px solid transparent;margin-bottom:-2px;cursor:pointer;transition:all .2s;}
.auth-main-tab.active{color:#111110;border-bottom-color:#111110;}
.auth-error-link{border:0;background:none;color:#1565C0;font:inherit;font-weight:900;cursor:pointer;padding:0 0 0 4px;text-decoration:underline;}

/* 表单面板 */
.auth-panel{display:none;padding-top:24px;}
.auth-panel.active{display:block;}

/* 登录方式子Tab */
.login-sub-tabs{display:flex;align-items:center;gap:0;margin-bottom:20px;}
.login-sub-tab{font-weight:800;font-size:13px;color:#C4C3BF;cursor:pointer;padding:4px 0;transition:color .2s;position:relative;}
.login-sub-tab.active{color:#111110;}
.login-sub-sep{font-size:12px;color:#EBEBEA;margin:0 12px;}
.login-sub-panel{display:none;}
.login-sub-panel.active{display:block;}

/* 输入框：底部线条风格 */
.auth-field{margin-bottom:20px;}
.auth-field-label{font-size:12px;font-weight:800;color:#787874;margin-bottom:6px;display:block;letter-spacing:.04em;}
.auth-field-row{display:flex;align-items:center;border-bottom:1.5px solid #C4C3BF;transition:border-color .2s;padding-bottom:2px;}
.auth-field-row:focus-within{border-color:#111110;}
.auth-field-row.error{border-color:#E03030;}
.auth-input{flex:1;height:40px;border:none;outline:none;background:none;font-family:inherit;font-weight:700;font-size:15px;color:#111110;padding:0;}
.auth-input::placeholder{color:#C4C3BF;}
.auth-input-btn{font-weight:800;font-size:12px;color:#111110;background:none;border:none;cursor:pointer;white-space:nowrap;padding:0 0 0 12px;transition:opacity .2s;font-family:inherit;}
.auth-input-btn:hover{opacity:.6;}
.auth-input-btn:disabled{color:#C4C3BF;cursor:not-allowed;}
.auth-input-btn.counting{color:#C4C3BF;cursor:not-allowed;}
.auth-field-err{font-size:11px;font-weight:700;color:#E03030;margin-top:5px;display:none;}
.auth-field-err.show{display:block;}
.auth-eye-btn{background:none;border:none;cursor:pointer;padding:0 0 0 8px;font-size:15px;color:#C4C3BF;transition:color .2s;font-family:inherit;}
.auth-eye-btn:hover{color:#111110;}

/* 协议 */
.auth-agree{display:flex;align-items:flex-start;gap:8px;margin-bottom:20px;}
.auth-agree-box{width:16px;height:16px;border-radius:4px;border:1.5px solid #C4C3BF;flex-shrink:0;margin-top:2px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .2s;}
.auth-agree-box.checked{background:#111110;border-color:#111110;}
.auth-agree-box.checked::after{content:'✓';font-size:10px;color:#fff;font-weight:900;}
.auth-agree-text{font-size:11px;font-weight:700;color:#787874;line-height:1.7;}
.auth-agree-text a{color:#111110;border-bottom:1px solid #EBEBEA;}
.auth-agree-text a:hover{border-color:#111110;}

/* 提交按钮 */
.auth-submit-btn{width:100%;height:50px;border-radius:12px;background:#111110;color:#fff;font-family:inherit;font-weight:900;font-size:15px;border:none;cursor:pointer;transition:opacity .2s,transform .15s;display:flex;align-items:center;justify-content:center;margin-top:4px;}
.auth-submit-btn:hover{opacity:.88;}
.auth-submit-btn:active{transform:scale(.98);}
.auth-submit-btn:disabled{opacity:.3;cursor:not-allowed;}
.auth-submit-btn.loading::after{content:'';width:15px;height:15px;border-radius:50%;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;animation:auth-spin .7s linear infinite;display:inline-block;margin-left:8px;}
@keyframes auth-spin{to{transform:rotate(360deg);}}

/* ── Toast ── */
.mowo-toast{position:fixed;bottom:32px;left:50%;transform:translateX(-50%) translateY(12px);background:#111110;color:#fff;font-weight:800;font-size:13px;padding:10px 22px;border-radius:999px;opacity:0;pointer-events:none;transition:all .3s cubic-bezier(.22,1,.36,1);z-index:9000;white-space:nowrap;font-family:'Nunito','Noto Sans SC',sans-serif;}
.mowo-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}
  `;
  document.head.appendChild(s);
}

/* ─────────────────────────────────────────
   注入弹窗 HTML
───────────────────────────────────────── */
function injectAuthModal() {
  if (document.getElementById('mowoAuthOverlay')) return;
  const div = document.createElement('div');
  div.innerHTML = `
<div class="auth-overlay" id="mowoAuthOverlay">
  <div class="auth-box" onclick="event.stopPropagation()">
    <div class="auth-box-bar"></div>
    <div class="auth-box-inner">
      <button class="auth-box-close" onclick="closeAuthModal()">✕</button>
      <p class="auth-box-logo">哞屋 MOWO</p>
      <p class="auth-box-logo-sub">动态文创 · 创作者平台</p>

      <!-- 主Tab：登录 / 注册 -->
      <div class="auth-main-tabs">
        <div class="auth-main-tab active" data-auth-tab="login" onclick="switchMainTab('login',this)">登录</div>
        <div class="auth-main-tab" data-auth-tab="register" onclick="switchMainTab('register',this)">注册</div>
      </div>

      <!-- ══ 登录面板 ══ -->
      <div class="auth-panel active" id="authLoginPanel">
        <!-- 验证码登录 -->
        <div class="login-sub-panel active" id="loginCodePanel">
          <div class="auth-field">
            <div class="auth-field-row" id="lcPhoneRow">
              <input class="auth-input" type="tel" id="lcPhone" placeholder="请输入手机号" maxlength="11" oninput="authFormatPhone(this)">
            </div>
            <p class="auth-field-err" id="lcPhoneErr">请输入正确的手机号</p>
          </div>
          <div class="auth-field">
            <div class="auth-field-row" id="lcCodeRow">
              <input class="auth-input" type="number" id="lcCode" placeholder="请输入验证码" maxlength="6">
              <button class="auth-input-btn" id="lcSendBtn" onclick="authSendCode('lc')">获取验证码</button>
            </div>
            <p class="auth-field-err" id="lcCodeErr">验证码不正确</p>
          </div>
          <button class="auth-submit-btn" id="lcSubmitBtn" onclick="submitLoginByCode()">登录</button>
        </div>

      </div>

      <!-- ══ 注册面板 ══ -->
      <div class="auth-panel" id="authRegPanel">
        <div class="auth-field">
          <div class="auth-field-row" id="regPhoneRow">
            <input class="auth-input" type="tel" id="regPhone" placeholder="请输入手机号" maxlength="11" oninput="authFormatPhone(this);checkRegForm()">
          </div>
          <p class="auth-field-err" id="regPhoneErr">请输入正确的手机号</p>
        </div>
        <div class="auth-field">
          <div class="auth-field-row" id="regCodeRow">
            <input class="auth-input" type="number" id="regCode" placeholder="请输入验证码" maxlength="6" oninput="checkRegForm()">
            <button class="auth-input-btn" id="regSendBtn" onclick="authSendCode('reg')">获取验证码</button>
          </div>
          <p class="auth-field-err" id="regCodeErr">验证码不正确</p>
        </div>
        <div class="auth-agree">
          <div class="auth-agree-box" id="authAgreeBox" onclick="authToggleAgree()"></div>
          <p class="auth-agree-text">我已阅读并同意 <a href="user-agreement.html" target="_blank" rel="noopener">《用户协议》</a> 和 <a href="privacy-policy.html" target="_blank" rel="noopener">《隐私政策》</a></p>
        </div>
        <button class="auth-submit-btn" id="regSubmitBtn" onclick="submitRegister()" disabled>注册并登录</button>
      </div>

    </div>
  </div>
</div>

<!-- ══ 信息完善弹窗 ══ -->
<div class="auth-overlay" id="mowoProfileOverlay" onclick="if(event.target===this)closeProfileModal()">
  <div class="auth-box" style="max-width:420px;" onclick="event.stopPropagation()">
    <div class="auth-box-bar" style="background:linear-gradient(90deg,#F5E642,#8FD694);"></div>
    <div class="auth-box-inner">
      <h2 style="font-weight:900;font-size:22px;letter-spacing:-.01em;margin-bottom:6px;">欢迎加入<span style="color:#FF6B35;">哞屋</span> 👋</h2>
      <p style="font-size:13px;font-weight:700;color:#787874;margin-bottom:24px;line-height:1.7;">最后一步，给自己起个昵称吧</p>
      <div class="auth-field">
        <label class="auth-field-label">昵称 <span style="color:#E03030;">*</span></label>
        <div class="auth-field-row">
          <input class="auth-input" type="text" id="profileNickname" placeholder="2-20个字符" maxlength="20" oninput="updateProfileBtn()">
          <span style="font-size:11px;color:#C4C3BF;font-weight:700;white-space:nowrap;padding-left:8px;"><span id="profileNicknameCount">0</span>/20</span>
        </div>
        <p class="auth-field-err" id="profileNicknameErr">昵称不能为空</p>
      </div>
      <button class="auth-submit-btn" id="profileSubmitBtn" onclick="submitProfile()" disabled>完成，进入哞屋 →</button>
    </div>
  </div>
</div>

<!-- ══ Toast ══ -->
<div class="mowo-toast" id="mowoToast"></div>
  `;
  const fragment = document.createDocumentFragment();
  div.childNodes.forEach(node => {
    if (node.nodeType === 1) fragment.appendChild(node.cloneNode(true));
  });
  // 逐个取出并添加
  while (div.firstElementChild) {
    document.body.appendChild(div.firstElementChild);
  }
}

/* ─────────────────────────────────────────
   注入导航栏用户区域
───────────────────────────────────────── */
function injectNavUser() {
  if (document.getElementById('mowoNavUser')) return;
  // 兼容新版 nav.js（.mowo-nav-right）和旧版（.nav-right）
  const navRight = document.querySelector('.mowo-nav-right') || document.querySelector('.nav-right');
  if (!navRight) return;

  const el = document.createElement('div');
  el.className = 'nav-user';
  el.id = 'mowoNavUser';
  el.innerHTML = `
    <button class="nav-avatar-btn" id="mowoNavAvatarBtn" onclick="toggleDropdown()">
      <div class="nav-avatar-circle" id="mowoNavAvatar">
        <span id="mowoNavAvatarInitial">?</span>
      </div>
      <span class="nav-uname" id="mowoNavUname"></span>
      <span class="nav-chevron">▾</span>
    </button>
    <div class="user-dropdown" id="mowoDropdown">
      <div class="dd-head">
        <div class="dd-av" id="mowoDdAv"><span id="mowoDdInitial">?</span></div>
        <div>
          <p class="dd-name" id="mowoDdName"></p>
          <span class="dd-badge user" id="mowoDdBadge">普通用户</span>
        </div>
      </div>
      <button class="dd-item" onclick="navGoTo('cart')">
        <div class="dd-item-icon" style="background:#FFFBE6;">🛒</div>购物车
      </button>
      <button class="dd-item" onclick="navGoTo('orders')">
        <div class="dd-item-icon" style="background:#EBF5FF;">📦</div>我的订单
      </button>
      <button class="dd-item" onclick="navGoTo('customizations')">
        <div class="dd-item-icon" style="background:#FFF3EE;">✂</div>我的定制
      </button>
      <button class="dd-item" onclick="navGoTo('myAnimations')">
        <div class="dd-item-icon" style="background:#F0F4FF;">🎬</div>我的动画
      </button>
      <button class="dd-item creator-only" onclick="navGoTo('myAnimations')">
        <div class="dd-item-icon" style="background:#FFF3FB;">✦</div>我的创作
      </button>
      <a class="dd-item admin-only" href="admin-orders.html">
        <div class="dd-item-icon" style="background:#FFF9C4;">🛠</div>进入后台
      </a>
      <div class="dd-divider"></div>
      <button class="dd-item" onclick="navGoTo('settings')">
        <div class="dd-item-icon" style="background:#EBEBEA;">⚙️</div>账号设置
      </button>
      <button class="dd-item" onclick="navGoTo('help')">
        <div class="dd-item-icon" style="background:#EBEBEA;">💬</div>帮助与反馈
      </button>
      <div class="dd-divider"></div>
      <button class="dd-item danger" onclick="navLogout()">
        <div class="dd-item-icon" style="background:#FFF5F5;">🚪</div>退出登录
      </button>
    </div>`;

  const loginBtn = document.getElementById('navLoginBtn');
  if (loginBtn) navRight.insertBefore(el, loginBtn);
  else navRight.appendChild(el);
}

/* ─────────────────────────────────────────
   更新导航栏状态
───────────────────────────────────────── */
function updateNavState(user) {
  const loginBtn = document.getElementById('navLoginBtn');
  const navUser  = document.getElementById('mowoNavUser');
  if (!navUser) return;

  if (user) {
    if (loginBtn) loginBtn.style.display = 'none';
    navUser.classList.add('show');
    if (user.certifyStatus === 2) navUser.classList.add('is-creator');
    else navUser.classList.remove('is-creator');

    // 固定员工岗位显示「进入后台」入口，具体页面仍由服务端权限控制。
    if (user.staffRole) navUser.classList.add('is-admin');
    else navUser.classList.remove('is-admin');

    const nickname  = user.profile?.nickname || '用户';
    const avatarUrl = user.profile?.avatarUrl;
    const initial   = nickname[0].toUpperCase();

    // 头像
    const navAv = document.getElementById('mowoNavAvatar');
    const ddAv  = document.getElementById('mowoDdAv');
    if (avatarUrl) {
      if (navAv) navAv.innerHTML = `<img src="${avatarUrl}" alt="头像">`;
      if (ddAv)  ddAv.innerHTML  = `<img src="${avatarUrl}" alt="头像">`;
    } else {
      const ni = document.getElementById('mowoNavAvatarInitial');
      const di = document.getElementById('mowoDdInitial');
      if (ni) ni.textContent = initial;
      if (di) di.textContent = initial;
    }

    const un = document.getElementById('mowoNavUname');
    const dn = document.getElementById('mowoDdName');
    if (un) un.textContent = nickname;
    if (dn) dn.textContent = nickname;

    const badge = document.getElementById('mowoDdBadge');
    if (badge) {
      const role = user.role ?? 0;
      if (role >= 3)              { badge.textContent='⭐ 超级管理员'; badge.className='dd-badge'; badge.style.cssText='background:#FCE4EC;color:#C62828;'; }
      else if (role === 2)        { badge.textContent='🛡 管理员';    badge.className='dd-badge'; badge.style.cssText='background:#FFF8E1;color:#B8860B;'; }
      else if (user.certifyStatus === 2) { badge.textContent='✦ 创作者'; badge.className='dd-badge creator'; badge.style.cssText=''; }
      else                        { badge.textContent='普通用户';    badge.className='dd-badge user';    badge.style.cssText=''; }
    }
  } else {
    if (loginBtn) loginBtn.style.display = '';
    navUser.classList.remove('show','is-creator','is-admin');
  }
}

/* ─────────────────────────────────────────
   下拉菜单
───────────────────────────────────────── */
function toggleDropdown() {
  const dd  = document.getElementById('mowoDropdown');
  const btn = document.getElementById('mowoNavAvatarBtn');
  if (!dd||!btn) return;
  const open = dd.classList.toggle('open');
  btn.classList.toggle('open', open);
  if (open) setTimeout(()=>document.addEventListener('click', outsideClick), 0);
  else document.removeEventListener('click', outsideClick);
}
function outsideClick(e) {
  const nu = document.getElementById('mowoNavUser');
  if (nu && !nu.contains(e.target)) {
    document.getElementById('mowoDropdown')?.classList.remove('open');
    document.getElementById('mowoNavAvatarBtn')?.classList.remove('open');
    document.removeEventListener('click', outsideClick);
  }
}
function navGoTo(page) {
  document.getElementById('mowoDropdown')?.classList.remove('open');
  document.getElementById('mowoNavAvatarBtn')?.classList.remove('open');
  const map = {
    cart:          'cart.html',
    orders:        'orders.html',
    customizations:'my-customizations.html',
    addresses:     'my-addresses.html',
    myAnimations:  'my-animations.html',
    creatorCenter: 'creator-dashboard.html',
    settings:      'settings.html',
    help:          'contact.html',
    admin:         'admin-orders.html',
  };
  window.location.href = map[page] || 'index.html';
}
async function logoutSession(scope = 'current') {
  _logoutInProgress = true;
  const endpoint = scope === 'all' ? '/api/v1/auth/logout-all' : '/api/v1/auth/logout';
  try {
    await fetch(`${MOWO_API_BASE}${endpoint}`, {
      method: 'POST',
      credentials: 'include',
      headers: getToken() ? { 'Authorization': `Bearer ${getToken()}` } : {}
    });
  } catch(_) {
    // 即使服务端暂时不可用，也要立即清除当前浏览器里的登录信息。
  } finally {
    removeToken();
    updateNavState(null);
  }
}

async function navLogout() {
  document.getElementById('mowoDropdown')?.classList.remove('open');
  document.getElementById('mowoNavAvatarBtn')?.classList.remove('open');
  await logoutSession('current');
  const protected_ = ['orders','cart','my-animations','settings','my-addresses','creator-dashboard','creator-earnings','creator-animations','creator-collab','creator-links'];
  const cur = window.location.pathname.split('/').pop().replace('.html','');
  if (protected_.includes(cur)) window.location.replace('index.html');
}

window.mowoLogout = logoutSession;

/* ─────────────────────────────────────────
   弹窗开关
───────────────────────────────────────── */
function openAuthModal() {
  document.getElementById('mowoAuthOverlay')?.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeAuthModal() {
  document.getElementById('mowoAuthOverlay')?.classList.remove('open');
  document.body.style.overflow = '';
}
function openProfileModal() {
  document.getElementById('mowoProfileOverlay')?.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeProfileModal() {
  document.getElementById('mowoProfileOverlay')?.classList.remove('open');
  document.body.style.overflow = '';
}

/* ─────────────────────────────────────────
   Tab 切换
───────────────────────────────────────── */
function switchMainTab(tab, btn) {
  document.querySelectorAll('.auth-main-tab').forEach(t=>t.classList.remove('active'));
  (btn || document.querySelector(`[data-auth-tab="${tab}"]`))?.classList.add('active');
  document.querySelectorAll('.auth-panel').forEach(p=>p.classList.remove('active'));
  document.getElementById(tab==='login'?'authLoginPanel':'authRegPanel').classList.add('active');
}
function authGoToMode(mode) {
  const sourceId = mode==='register' ? 'lcPhone' : 'regPhone';
  const targetId = mode==='register' ? 'regPhone' : 'lcPhone';
  const source = document.getElementById(sourceId)?.value || '';
  switchMainTab(mode);
  const target = document.getElementById(targetId);
  if (target) { target.value=source; target.focus(); }
  if (mode==='register') checkRegForm();
}
function authShowAccountModeError(errId, code, fallback) {
  const error = document.getElementById(errId);
  if (!error) return;
  if (code==='ACCOUNT_NOT_FOUND') {
    error.innerHTML = '该手机号尚未注册。<button type="button" class="auth-error-link" onclick="authGoToMode(\'register\')">前往注册</button>';
  } else if (code==='ACCOUNT_ALREADY_EXISTS') {
    error.innerHTML = '该手机号已注册。<button type="button" class="auth-error-link" onclick="authGoToMode(\'login\')">返回登录</button>';
  } else {
    error.textContent = fallback;
  }
  error.classList.add('show');
}
function switchSubTab(method, btn) {
  document.querySelectorAll('.login-sub-tab').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.login-sub-panel').forEach(p=>p.classList.remove('active'));
  document.getElementById(method==='code'?'loginCodePanel':'loginPwdPanel').classList.add('active');
}

/* ─────────────────────────────────────────
   表单工具
───────────────────────────────────────── */
function authFormatPhone(input) { input.value=input.value.replace(/\D/g,'').slice(0,11); }
function authValidatePhone(v)   { return /^1[3-9]\d{9}$/.test(v); }
function authValidatePwd(v)     { return v.length>=8&&/[a-zA-Z]/.test(v)&&/[0-9]/.test(v); }
function authTogglePwd(id, btn) {
  const el=document.getElementById(id);
  const isPwd=el.type==='password';
  el.type=isPwd?'text':'password';
  btn.textContent=isPwd?'🙈':'👁';
}

/* ── 验证码倒计时 ── */
let _cdTimer = null;
async function authSendCode(type) {
  const phoneId = type==='lc'?'lcPhone':'regPhone';
  const btnId   = type==='lc'?'lcSendBtn':'regSendBtn';
  const errId   = type==='lc'?'lcPhoneErr':'regPhoneErr';
  const rowId   = type==='lc'?'lcPhoneRow':'regPhoneRow';
  const phone   = document.getElementById(phoneId).value;

  if (!authValidatePhone(phone)) {
    document.getElementById(rowId).classList.add('error');
    document.getElementById(errId).classList.add('show');
    return;
  }
  document.getElementById(rowId).classList.remove('error');
  document.getElementById(errId).classList.remove('show');

  const btn = document.getElementById(btnId);
  btn.disabled=true; btn.textContent='发送中...';

  try {
    const purpose = type==='reg' ? 'REGISTER' : 'LOGIN';
    const res  = await fetch(`${MOWO_API_BASE}/api/v1/auth/sms/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, purpose })
    });
    const json = await res.json();
    if (!res.ok) {
      authShowAccountModeError(errId, json.code, json.message || '发送失败，请重试');
      btn.disabled=false; btn.textContent='获取验证码';
      return;
    }
    // 开发Mock模式：提示验证码
    if (json._devCode) showToast(`[开发] 验证码：${json._devCode}`);
  } catch(e) {
    document.getElementById(errId).textContent = '网络异常，请稍后重试';
    document.getElementById(errId).classList.add('show');
    btn.disabled=false; btn.textContent='获取验证码';
    return;
  }

  // 倒计时
  let s=60;
  btn.classList.add('counting'); btn.textContent=`${s}s后重发`;
  clearInterval(_cdTimer);
  _cdTimer=setInterval(()=>{
    s--; btn.textContent=`${s}s后重发`;
    if(s<=0){ clearInterval(_cdTimer); btn.disabled=false; btn.classList.remove('counting'); btn.textContent='获取验证码'; }
  },1000);
}

/* ── 注册表单实时校验 ── */
let _regAgree = false;
function authToggleAgree() {
  _regAgree=!_regAgree;
  document.getElementById('authAgreeBox').classList.toggle('checked',_regAgree);
  checkRegForm();
}
function checkRegForm() {
  const phone = document.getElementById('regPhone')?.value||'';
  const code  = document.getElementById('regCode')?.value||'';
  const btn   = document.getElementById('regSubmitBtn');
  if (btn) btn.disabled = !(authValidatePhone(phone) && code.length===6 && _regAgree);
}

/* ─────────────────────────────────────────
   验证码登录
───────────────────────────────────────── */
async function submitLoginByCode() {
  const phone = document.getElementById('lcPhone').value;
  const code  = document.getElementById('lcCode').value;
  if (!authValidatePhone(phone)) {
    document.getElementById('lcPhoneRow').classList.add('error');
    document.getElementById('lcPhoneErr').classList.add('show'); return;
  }
  if (code.length!==6) {
    document.getElementById('lcCodeRow').classList.add('error');
    document.getElementById('lcCodeErr').classList.add('show'); return;
  }
  const btn=document.getElementById('lcSubmitBtn');
  btn.classList.add('loading'); btn.textContent=''; btn.disabled=true;
  try {
    const res  = await fetch(`${MOWO_API_BASE}/api/v1/auth/sms/verify`, {
      method: 'POST',
      credentials: 'include', // 接收 refresh_token HttpOnly Cookie
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ phone, code, mode: 'LOGIN' })
    });
    const json = await res.json();
    if (json.success) {
      closeAuthModal();
      await _finalizeLogin(json.data.token || json.data.accessToken);
    } else {
      authShowAccountModeError('lcCodeErr', json.code, json.message || '登录失败');
    }
  } catch(e) {
    document.getElementById('lcCodeErr').textContent='网络异常，请稍后重试';
    document.getElementById('lcCodeErr').classList.add('show');
  }
  btn.classList.remove('loading'); btn.textContent='登录'; btn.disabled=false;
}

/* ─────────────────────────────────────────
   密码登录
───────────────────────────────────────── */
async function submitLoginByPassword() {
  const phone = document.getElementById('lpPhone').value;
  const pwd   = document.getElementById('lpPwd').value;
  if (!authValidatePhone(phone)) {
    document.getElementById('lpPhoneRow').classList.add('error');
    document.getElementById('lpPhoneErr').classList.add('show'); return;
  }
  if (!pwd) {
    document.getElementById('lpPwdErr').classList.add('show'); return;
  }
  const btn=document.getElementById('lpSubmitBtn');
  btn.classList.add('loading'); btn.textContent=''; btn.disabled=true;
  try {
    const res  = await fetch(`${MOWO_API_BASE}/api/v1/auth/password/login`, {
      method: 'POST',
      credentials: 'include', // 接收 refresh_token HttpOnly Cookie
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ phone, password: pwd })
    });
    const json = await res.json();
    if (json.success) {
      closeAuthModal();
      await _finalizeLogin(json.data.token || json.data.accessToken);
    } else {
      // LOGIN_LOCKED：展示锁定剩余时间
      const msg = json.code==='LOGIN_LOCKED'
        ? `连续登录失败次数过多，账号已锁定 ${json.remainingMin||30} 分钟`
        : (json.message || '手机号或密码不正确');
      document.getElementById('lpPwdErr').textContent = msg;
      document.getElementById('lpPwdErr').classList.add('show');
    }
  } catch(e) {
    document.getElementById('lpPwdErr').textContent='网络异常，请稍后重试';
    document.getElementById('lpPwdErr').classList.add('show');
  }
  btn.classList.remove('loading'); btn.textContent='登录'; btn.disabled=false;
}

/* ─────────────────────────────────────────
   注册
───────────────────────────────────────── */
let _pendingToken = null;
async function submitRegister() {
  const phone = document.getElementById('regPhone').value;
  const code  = document.getElementById('regCode').value;
  if (!authValidatePhone(phone) || code.length!==6 || !_regAgree) return;
  const btn=document.getElementById('regSubmitBtn');
  btn.classList.add('loading'); btn.textContent=''; btn.disabled=true;
  try {
    // 注册使用 v1 SMS verify 接口（新手机号自动注册）
    const res  = await fetch(`${MOWO_API_BASE}/api/v1/auth/sms/verify`, {
      method: 'POST',
      credentials: 'include',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ phone, code, mode: 'REGISTER', agreedToPrivacy: true })
    });
    const json = await res.json();
    if (json.success) {
      _pendingToken = json.data.token || json.data.accessToken;
      closeAuthModal();
      openProfileModal();
    } else {
      const msg = json.code==='PRIVACY_NOT_AGREED'
        ? '请先勾选同意《隐私政策》和《用户协议》'
        : (json.message || '注册失败，请重试');
      authShowAccountModeError('regCodeErr', json.code, msg);
    }
  } catch(e) {
    document.getElementById('regCodeErr').textContent='网络异常，请稍后重试';
    document.getElementById('regCodeErr').classList.add('show');
  }
  btn.classList.remove('loading'); btn.textContent='注册并登录'; btn.disabled=false;
}

/* ─────────────────────────────────────────
   信息完善
───────────────────────────────────────── */
function updateProfileBtn() {
  const v=document.getElementById('profileNickname')?.value||'';
  document.getElementById('profileNicknameCount').textContent=v.length;
  const btn=document.getElementById('profileSubmitBtn');
  if(btn) btn.disabled=v.trim().length===0;
}
async function submitProfile() {
  const nickname=document.getElementById('profileNickname').value.trim();
  if(!nickname) return;
  const btn=document.getElementById('profileSubmitBtn');
  btn.classList.add('loading'); btn.textContent=''; btn.disabled=true;
  const token=_pendingToken||getToken();
  try {
    await fetch(`${MOWO_API_BASE}/api/v1/account/profile`,{method:'PUT',credentials:'include',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({nickname})});
    closeProfileModal();
    await _finalizeLogin(token);
  } catch(e) { console.error('完善资料失败',e); }
  btn.classList.remove('loading'); btn.textContent='完成，进入哞屋 →'; btn.disabled=false;
}

/* ─────────────────────────────────────────
   登录完成：存token、更新导航栏
───────────────────────────────────────── */
async function _finalizeLogin(token) {
  setToken(token);
  localStorage.removeItem(USER_KEY); // 清缓存，重新拉最新数据
  const user = await fetchCurrentUser();
  updateNavState(user);
  showToast(`👋 欢迎回来，${user?.profile?.nickname||'用户'}！`);
  window.dispatchEvent(new CustomEvent('mowoLoginCompleted', { detail: { user } }));

  const params = new URLSearchParams(window.location.search);
  const redirect = params.get('redirect');
  if (redirect && redirect.startsWith('/') && !redirect.startsWith('//')) {
    window.location.href = redirect;
  }
}

/* ─────────────────────────────────────────
   Toast
───────────────────────────────────────── */
var _authToastTimer;
function showToast(msg) {
  const t=document.getElementById('mowoToast');
  if(!t) return;
  t.textContent=msg; t.classList.add('show');
  clearTimeout(_authToastTimer);
  _authToastTimer=setTimeout(()=>t.classList.remove('show'),2600);
}

/* ─────────────────────────────────────────
   对外暴露（供其他页面调用）
───────────────────────────────────────── */
window.openAuthModal      = openAuthModal;
window.closeAuthModal     = closeAuthModal;
window.showToast          = showToast;
window.getToken           = getToken;
window.fetchCurrentUser   = fetchCurrentUser;
window.refreshAccessToken = refreshAccessToken;
window.mowoClearLocalSession = clearLocalSession;

/* ─────────────────────────────────────────
   页面初始化
───────────────────────────────────────── */
async function init() {
  injectCSS();
  injectNavUser();
  injectAuthModal();

  // 绑定登录按钮点击
  const loginBtn = document.getElementById('navLoginBtn');
  if (loginBtn) loginBtn.addEventListener('click', openAuthModal);

  // 页面加载时处理现有 token：过期则立即刷新，否则调度主动刷新定时器
  const existing = getToken();
  if (existing) {
    try {
      const exp = JSON.parse(atob(existing.split('.')[1])).exp;
      if (exp * 1000 < Date.now()) {
        // Token 已过期，立即静默刷新（不等待，让 fetchCurrentUser 的拦截器处理）
        refreshAccessToken();
      } else {
        _scheduleProactiveRefresh(existing);
      }
    } catch(_) { _scheduleProactiveRefresh(existing); }
  }

  const user = await fetchCurrentUser();
  updateNavState(user);
  if (new URLSearchParams(window.location.search).get('auth') === '1' && !user) {
    openAuthModal();
  }
}

// 部分后台页面在 <head> 中加载 auth.js；等待 body 建立后再注入弹窗。
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
