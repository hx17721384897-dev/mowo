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

  toCommunity(tag = null) {
    // tag 有值时跳转到对应标签的筛选结果
    const url = tag
      ? `/pages/community.html?tag=${encodeURIComponent(tag)}`
      : '/pages/community.html'
    this.go(url)
  },

  toContact() {
    this.go('/pages/contact.html')
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
  // 内容详情页
  // ─────────────────────────────────────────

  toArticleDetail(id) {
    this.go(`/pages/article-detail.html?id=${id}`)
  },

  toProductDetail(id) {
    this.go(`/pages/product-detail.html?id=${id}`)
  },

  toCreatorProfile(id) {
    this.go(`/pages/creator-profile.html?id=${id}`)
  },

  // ─────────────────────────────────────────
  // 定制流程
  // ─────────────────────────────────────────

  toCustomizeStart() {
    this.go('/pages/customize-start.html')
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

  toFavorites() {
    this.go('/pages/favorites.html')
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

  toAccount() {
    this.go('/pages/account.html')
  },

  // ─────────────────────────────────────────
  // 创作者后台
  // ─────────────────────────────────────────

  toCreatorWorks() {
    this.go('/pages/creator-works.html')
  },

  toCreatorEarnings() {
    this.go('/pages/creator-earnings.html')
  },

  toCreatorCertify() {
    this.go('/pages/creator-certify.html')
  },

  toCreatorArticleStats(id) {
    this.go(`/pages/creator-article-stats.html?id=${id}`)
  },

  toCreatorProductStats(id) {
    this.go(`/pages/creator-product-stats.html?id=${id}`)
  },

  // 新建商品（从动画出发，带 animationId）
  toCreatorProductEdit(animationId = null, productId = null) {
    if (productId) {
      // 编辑已有商品
      this.go(`/pages/creator-product-edit.html?productId=${productId}`)
    } else if (animationId) {
      // 从动画新建商品
      this.go(`/pages/creator-product-edit.html?animationId=${animationId}`)
    } else {
      // 直接进入新建模式
      this.go('/pages/creator-product-edit.html')
    }
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

  // 检查是否为认证创作者
  // 需要配合 API 使用，这里只做本地快速判断
  requireCreator() {
    const userStr = localStorage.getItem('mowo_user')
    if (!userStr) {
      this.toAuth(window.location.pathname)
      return false
    }
    const user = JSON.parse(userStr)
    if (user.certifyStatus !== 2) {
      // 弹出提示，不跳转
      alert('请先完成创作者认证')
      return false
    }
    return true
  }
}

// 当前项目通过普通 <script> 标签加载本文件，因此直接挂到网页全局使用。
window.Router = Router
