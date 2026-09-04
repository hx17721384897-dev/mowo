import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'acorn'

const pagePath = path.resolve('../frontend/pages/admin-collab-product-edit.html')
const html = fs.readFileSync(pagePath, 'utf8')

function assert(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`PASS ${message}`)
}

const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1])
  .filter(source => source.trim())

for (const source of inlineScripts) parse(source, { ecmaVersion: 'latest' })
assert(inlineScripts.length > 0, '联名商品编辑页脚本语法有效')
assert(html.includes("addEventListener('input',handleLiveInput)") && html.includes("addEventListener('change',handleLiveInput)"), '商品资料和规格变化会触发实时上架检查')
assert(html.includes('function collectIssues()') && html.includes('function renderReadinessLive()'), '页面从当前未保存内容计算上架条件')
assert(html.includes("showIssueFeedback(issues,'预览')") && html.includes("showIssueFeedback(issues,'上架')"), '预览和上架会提示缺失的必填内容')
assert(html.includes("issues.filter(issue=>issue.blockSave)"), '草稿保存仅阻止无效格式，不强迫一次填完')
assert(html.includes('scrollIntoView') && html.includes('field-error'), '检查项可以定位并标记对应填写位置')
assert(html.includes("rows.filter(r=>r.isEnabled)") && html.includes("media.find(item=>item.key===data.coverKey)"), '顾客预览只展示启用规格并使用选定封面')
assert(html.includes('isLegacyCover(data.coverKey)') && html.includes('旧版封面不能用于正式商品，请重新上传'), '旧版内嵌封面不会继续进入正式商品流程')

console.log('Collab product editor UI checks passed')
