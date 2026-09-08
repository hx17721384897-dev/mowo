// 首发功能开关由服务端统一提供；本文件只负责隐藏入口和处理旧页面直达。
(function () {
  const API = typeof window.MOWO_API_BASE === 'string'
    ? window.MOWO_API_BASE
    : ((location.hostname === 'localhost' || location.hostname === '127.0.0.1')
        ? location.protocol + '//' + location.hostname + ':3001'
        : '');
  let promise;

  function load() {
    if (!promise) {
      promise = fetch(`${API}/api/config/features`)
        .then(res => res.ok ? res.json() : Promise.reject(new Error('feature flags unavailable')))
        .then(json => {
          window.mowoFeatures = json.data || {};
          return window.mowoFeatures;
        })
        .catch(() => ({
          community: false,
          onlineCheckout: false,
          passwordLogin: false
        }));
    }
    return promise;
  }

  function hideLinks(part) {
    document.querySelectorAll(`a[href*="${part}"]`).forEach(link => link.remove());
  }

  async function apply() {
    const flags = await load();
    window.mowoFeatures = flags;

    if (!flags.community) {
      document.querySelectorAll('[data-feature-community]').forEach(element => element.remove());
    }

    const page = location.pathname.split('/').pop().toLowerCase();
    const disabledPages = {
    };
    if (!disabledPages[page]) return flags;

    const isAdmin = page.startsWith('admin-');
    const target = isAdmin ? 'admin-orders.html' : 'my-animations.html';
    location.replace(`${target}?notice=feature-not-available`);
    return flags;
  }

  window.getMowoFeatureFlags = load;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  } else {
    apply();
  }
})();
