import { chromium } from '../../frontend-vue/node_modules/playwright/index.mjs'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const directory = dirname(fileURLToPath(import.meta.url))
const templateUrl = pathToFileURL(join(directory, '订单页面效果图.html')).href
const browser = await chromium.launch({ headless: true })

try {
  for (const target of [
    { name: '我的订单-桌面效果图.png', query: 'list', width: 1440, height: 900 },
    { name: '订单详情-桌面效果图.png', query: 'detail', width: 1440, height: 900 },
    { name: '我的订单-手机效果图.png', query: 'list', width: 390, height: 844 },
    { name: '订单详情-手机效果图.png', query: 'detail', width: 390, height: 844 }
  ]) {
    const page = await browser.newPage({
      viewport: { width: target.width, height: target.height },
      deviceScaleFactor: 1
    })
    await page.goto(`${templateUrl}?view=${target.query}`)
    await page.screenshot({ path: join(directory, target.name), fullPage: true })
    await page.close()
    process.stdout.write(`${target.name}\n`)
  }
} finally {
  await browser.close()
}
