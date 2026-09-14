import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const nginx = fs.readFileSync(path.join(root, 'deploy/nginx.app.conf'), 'utf8')
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
const runtime = fs.readFileSync(path.join(root, 'public/runtime-config.js'), 'utf8')
const redirects = fs.readFileSync(path.join(root, 'deploy/nginx.v1a-redirects.conf'), 'utf8')

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
  ['privacy-policy.html', '/app/legal/privacy']
]
for (const [legacy, target] of requiredRedirects) {
  if (!redirects.includes(legacy) || !redirects.includes(`302 ${target}`)) {
    throw new Error(`V1a 缺少可回退的旧地址映射：${legacy} -> ${target}`)
  }
}
if (!runtime.includes('legacyWebBase')) {
  throw new Error('运行时配置必须声明尚未迁移的旧公开页面基址')
}

for (const file of ['showcase.html', 'customize-start.html', 'contact.html']) {
  if (!fs.existsSync(path.join(root, '..', 'frontend', 'pages', file))) {
    throw new Error(`V1a 交接入口不存在：frontend/pages/${file}`)
  }
}

console.log('Vue deployment and V1a redirect boundaries passed')
