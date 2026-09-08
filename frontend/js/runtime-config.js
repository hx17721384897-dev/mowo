/*
 * 浏览器运行时配置。
 *
 * 邀请测试和正式部署默认让静态站点通过同源反向代理访问 /api；
 * 本地静态服务器则连接同一主机的 3001 端口。需要部署到独立 API
 * 域名时，可在页面最早加载此脚本前设置 window.MOWO_RUNTIME_API_BASE。
 */
;(function () {
  function normalize(value) {
    return String(value || '').trim().replace(/\/$/, '')
  }

  var configured = normalize(window.MOWO_RUNTIME_API_BASE)
  if (configured) {
    window.MOWO_API_BASE = configured
    return
  }

  var isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  window.MOWO_API_BASE = isLocal
    ? location.protocol + '//' + location.hostname + ':3001'
    : ''
})()
