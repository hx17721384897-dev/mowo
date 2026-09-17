// js/router.js
// 统一管理所有页面跳转逻辑
// 使用方式：在任何页面引入此文件后调用 Router.xxx() 方法

const Router = {

  // ─────────────────────────────────────────
  // 基础跳转
  // ─────────────────────────────────────────

  go(path) {
    window.location.href = path
  },

  // 返回上一页，如果没有历史记录则跳到首页
  back(fallback = '/pages/index.html') {
    if (document.referrer) {
      window.history.back()
    } else {
      this.go(fallback)
    }
  },

  // ─────────────────────────────────────────
  // 主站页面
  // ─────────────────────────────────────────

  toHome() {
    this.go('/pages/index.html')
  },

  toAbout() {
    this.go('/pages/about.html')
  },

  toProducts() {
    this.go('/pages/products.html')
  },

  toContact() {
    this.go('/app/contact')
  },

  toSupport() {
    this.go('/pages/support.html')
  },

  toAuth(redirect = null) {
    // 项目使用各页面共用的登录弹窗，没有独立 auth.html。
    const url = redirect
      ? `index.html?auth=1&redirect=${encodeURIComponent(redirect)}`
      : 'index.html?auth=1'
    this.go(url)
  },

  // ─────────────────────────────────────────
  // 定制流程
  // ─────────────────────────────────────────

  toCustomizeStart() {
    this.go('/app/customize')
  },

  toCustomizeEditor(machine, frames) {
    this.go(`/pages/customize-editor.html?machine=${machine}&frames=${frames}`)
  },

  toCustomizeConfirm() {
    this.go('/pages/customize-confirm.html')
  },

  // ─────────────────────────────────────────
  // 用户中心
  // ─────────────────────────────────────────

  toCart() {
    this.go('/pages/cart.html')
  },

  toOrders() {
    this.go('/pages/orders.html')
  },

  toOrderDetail(id) {
    this.go(`/pages/order-detail.html?id=${id}`)
  },

  toCheckout() {
    this.go('/pages/checkout.html')
  },

  // ─────────────────────────────────────────
  // 工具方法
  // ─────────────────────────────────────────

  // 从URL里读取参数
  // 用法：Router.getParam('id') 读取当前页面 URL 的 id 参数
  getParam(key) {
    const params = new URLSearchParams(window.location.search)
    return params.get(key)
  },

  // 复制当前页面链接到剪贴板（分享按钮用）
  copyCurrentUrl() {
    const url = window.location.href
    navigator.clipboard.writeText(url).then(() => {
      // 复制成功，调用方自己处理提示
      return true
    }).catch(() => {
      // 降级方案：用旧方法
      const input = document.createElement('input')
      input.value = url
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
      return true
    })
  },

  // 检查是否已登录，没登录则跳到登录页
  requireAuth() {
    const token = localStorage.getItem('mowo_token')
    if (!token) {
      this.toAuth(window.location.pathname)
      return false
    }
    return true
  },

}

// 当前项目通过普通 <script> 标签加载本文件，因此直接挂到网页全局使用。
window.Router = Router
