import fs from 'node:fs/promises'
import path from 'node:path'

const pagesDir = new URL('../../frontend/pages/', import.meta.url)
const scriptsDir = new URL('../../frontend/js/', import.meta.url)
const names = (await fs.readdir(pagesDir)).filter(name => /^admin-.*\.html$/.test(name)).sort()
const errors = []

for (const name of (await fs.readdir(pagesDir)).filter(name => name.endsWith('.html'))) {
  const html = await fs.readFile(new URL(name, pagesDir), 'utf8')
  if (html.includes('../js/auth.js') && !html.includes('../js/runtime-config.js')) {
    errors.push(`${name}: 加载 auth.js 但缺少 runtime-config.js`)
  }
}

for (const name of names) {
  const html = await fs.readFile(new URL(name, pagesDir), 'utf8')
  if (!html.includes('../js/runtime-config.js')) errors.push(`${name}: 缺少 runtime-config.js`)
  if (!html.includes('../js/auth.js')) errors.push(`${name}: 缺少 auth.js`)
  if (/https?:\/\/(?:localhost|127\.0\.0\.1):3001/.test(html)) errors.push(`${name}: 仍硬编码本机 API 地址`)
  if (/JSON\.parse\(atob\([^\n]+split\(['"]\.['"]\)/.test(html)) errors.push(`${name}: 仍直接解析 JWT 角色`)
  if (/(?:user|me|json\.data)\.role\s*[<>]=?/.test(html) || /initPermission\(user\.role\)/.test(html)) {
    errors.push(`${name}: 仍使用数字角色做页面权限判断`)
  }
}

for (const name of [
  'admin-sidebar.js',
  'customization-review-editor.js',
  'private-upload.js'
]) {
  const source = await fs.readFile(new URL(name, scriptsDir), 'utf8')
  if (/https?:\/\/(?:localhost|127\.0\.0\.1):3001/.test(source)) errors.push(`${name}: 仍硬编码本机 API 地址`)
}

if (errors.length) throw new Error(`后台运行时配置检查失败：\n${errors.join('\n')}`)
console.log(`Admin runtime configuration check passed for ${names.length} pages`)
