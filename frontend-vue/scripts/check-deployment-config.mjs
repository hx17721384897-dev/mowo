import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const nginx = fs.readFileSync(path.join(root, 'deploy/nginx.app.conf'), 'utf8')
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
const runtime = fs.readFileSync(path.join(root, 'public/runtime-config.js'), 'utf8')
const redirects = fs.readFileSync(path.join(root, 'deploy/nginx.v1a-redirects.conf'), 'utf8')
const viteConfig = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8')
const vueRouter = fs.readFileSync(path.join(root, 'src', 'router', 'index.ts'), 'utf8')
const legacyEditor = fs.readFileSync(
  path.join(root, '..', 'frontend', 'pages', 'customize-editor.html'),
  'utf8'
)

const apiLocation = nginx.indexOf('location ^~ /api/')
const appLocation = nginx.indexOf('location /app/')
if (apiLocation < 0 || appLocation < 0 || apiLocation > appLocation) {
  throw new Error('Nginx 必须先声明 /api/，再声明 Vue /app/ history fallback')
}
if (!nginx.includes('try_files $uri $uri/ /app/index.html;')) {
  throw new Error('Nginx 缺少 /app/ 深链接 fallback')
}
if (!nginx.includes('location = /app/runtime-config.js') || !nginx.includes('no-store')) {
  throw new Error('runtime-config.js 必须独立提供并禁止缓存')
}
if (!index.includes('/app/runtime-config.js')) {
  throw new Error('index.html 必须在应用代码前加载运行时配置')
}
if (/localhost|127\.0\.0\.1/.test(runtime)) {
  throw new Error('生产运行时配置模板不得包含本机 API 地址')
}

const requiredRedirects = [
  ['index.html', '/app/'],
  ['about.html', '/app/about'],
  ['products.html', '/app/products'],
  ['faq.html', '/app/faq'],
  ['user-agreement.html', '/app/legal/terms'],
  ['privacy-policy.html', '/app/legal/privacy'],
  ['contact.html', '/app/contact'],
  ['customize-start.html', '/app/customize'],
  ['customize-confirm.html', '/app/customize/confirm'],
  ['settings.html', '/app/account/settings'],
  ['my-addresses.html', '/app/account/settings'],
  ['showcase.html', '/app/showcase'],
  ['showcase-detail.html', '/app/showcase-detail'],
  ['cart.html', '/app/cart'],
  ['checkout.html', '/app/checkout'],
  ['orders.html', '/app/orders'],
  ['order-detail.html', '/app/order-detail'],
  ['admin-contact.html', '/app/admin/contact'],
  ['admin-models.html', '/app/admin/models'],
  ['admin-frame-library.html', '/app/admin/frame-library']
]
for (const [legacy, target] of requiredRedirects) {
  if (!redirects.includes(legacy) || !redirects.includes(`302 ${target}`)) {
    throw new Error(`V1a 缺少可回退的旧地址映射：${legacy} -> ${target}`)
  }
}
if (!runtime.includes('legacyWebBase')) {
  throw new Error('运行时配置必须声明尚未迁移的旧公开页面基址')
}
if (
  !viteConfig.includes("target: 'http://127.0.0.1:3001'") ||
  !viteConfig.includes('changeOrigin: false')
) {
  throw new Error('Vite 开发环境必须把同源 /api 请求代理到本地 API')
}
if (
  !vueRouter.includes("path: 'customize/confirm'") ||
  !vueRouter.includes("name: 'customize-confirm'")
) {
  throw new Error('Vue 必须保留正式定制确认路由及其深链接能力')
}

for (const retired of [
  'customize-start.html',
  'customize-confirm.html',
  'settings.html',
  'my-addresses.html',
  'my-animations.html',
  'my-customizations.html',
  'cart.html',
  'checkout.html',
  'orders.html',
  'order-detail.html',
  'admin-contact.html',
  'admin-models.html',
  'admin-frame-library.html'
]) {
  if (fs.existsSync(path.join(root, '..', 'frontend', 'pages', retired))) {
    throw new Error(`已由 Vue 接管的旧页面不得继续存在：frontend/pages/${retired}`)
  }
}
if (
  !legacyEditor.includes('handoffNewCustomizationToVue') ||
  !legacyEditor.includes("var internalModeKeys = ['adminRequestId', 'frameDraftId']")
) {
  throw new Error('旧共享编辑器必须把全部用户模式交给 Vue，仅保留明确的后台模式边界')
}

console.log('Vue deployment and public redirect boundaries passed')
