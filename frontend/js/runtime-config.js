/*
 * 浏览器运行时配置。
 *
 * 后续部署默认让静态站点通过同源反向代理访问 /api；
 * 本地静态服务器则连接同一主机的 3001 端口。需要部署到独立 API
 * 域名时，可在页面最早加载此脚本前设置 window.MOWO_RUNTIME_API_BASE。
 * 本地旧页面交接 Vue 预览时可用 window.MOWO_RUNTIME_APP_BASE 覆盖默认地址。
 */
;(function () {
  function normalize(value) {
    return String(value || '').trim().replace(/\/$/, '')
  }

  var configured = normalize(window.MOWO_RUNTIME_API_BASE)
  var configuredApp = normalize(window.MOWO_RUNTIME_APP_BASE)
  var isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  window.MOWO_APP_BASE = configuredApp || (isLocal
    ? location.protocol + '//' + location.hostname + ':4173/app'
    : '/app')
  if (configured) {
    window.MOWO_API_BASE = configured
    return
  }

  window.MOWO_API_BASE = isLocal
    ? location.protocol + '//' + location.hostname + ':3001'
    : ''
})()
