import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'acorn'

const frontend = path.resolve('../frontend')
const detailPath = path.join(frontend, 'pages', 'showcase-detail.html')
const scriptPath = path.join(frontend, 'js', 'showcase-detail.js')
const listPath = path.join(frontend, 'pages', 'showcase.html')
const html = fs.readFileSync(detailPath, 'utf8')
const script = fs.readFileSync(scriptPath, 'utf8')
const list = fs.readFileSync(listPath, 'utf8')

function assert(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`PASS ${message}`)
}

parse(script, { ecmaVersion: 'latest' })
assert(!fs.existsSync(path.join(frontend, 'pages', 'showcase-confirm.html')) && !fs.existsSync(path.join(frontend, 'pages', 'showcase-confirm-v2.html')), '两份旧联名详情业务文件已经删除')
assert(list.includes('showcase-detail.html?workId=') && !/showcase-confirm(?:-v2)?\.html/.test(list), '联名列表只进入唯一详情页')
assert(['storefrontMedia', 'storefrontTags', 'work.description', 'supportedSkus'].every(key => script.includes(key)), '详情页呈现后台配置的轮播、标签、详情和销售 SKU')
assert(['modelName', 'size', 'frameCount', 'material', 'colorName', 'finalPrice', 'fulfillmentMode', 'leadTimeDays'].every(key => script.includes(key)), '顾客按完整 SKU 信息选择款式')
assert(script.includes("mowoLoginCompleted") && script.includes('mowo_pending_purchase') && !script.includes('mowo_guest_cart'), '未登录购买使用一次性操作意图并在登录后继续')
assert(!/toggleLike|toggleFollow|DEMO|用户评价|粉丝|已售/.test(html + script), '首版详情页不包含社区活动和虚假交易数据')
assert(html.includes('@media(max-width:900px)') && html.includes('purchase-bar'), '详情页具备移动端购买栏和响应式布局')

console.log('Collab customer detail UI checks passed')
