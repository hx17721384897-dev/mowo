import { expect, test, type Page, type Route } from '@playwright/test'

const sku = (id: string, code: string, assigned: boolean) => ({
  id,
  skuCode: code,
  size: '5×5cm',
  material: id === 'sku-3' ? '亚克力' : '椴木板',
  frameCount: id === 'sku-2' ? 24 : 12,
  colorName: id === 'sku-2' ? '红色' : '原色',
  colorHex: id === 'sku-2' ? '#cc3355' : '#ddcc99',
  isActive: true,
  sortOrder: 0,
  modelId: `model-${id}`,
  modelName: id === 'sku-2' ? '<img src=x onerror=alert(1)>宝盒款' : '基础款',
  modelActive: true,
  modelSortOrder: 0,
  previewUrl: id === 'sku-2' ? 'javascript:alert(1)' : null,
  assignment: assigned
    ? { ruleId: `rule-${id}`, groupId: 'group-1', groupName: 'A4 5×5 单页12帧', active: true }
    : null
})
const skus = [
  sku('sku-1', 'SKU-001', true),
  sku('sku-2', 'SKU-002', true),
  sku('sku-3', 'SKU-003', false)
]
const groups = [
  {
    id: 'group-1',
    code: 'PCG-001',
    name: 'A4 5×5 单页12帧',
    size: '5×5cm',
    paperSize: 'A4',
    paperType: '普通打印纸',
    orientation: 'LANDSCAPE',
    frameWidthMm: 50,
    frameHeightMm: 50,
    framesPerSheet: 12,
    renderDpi: 600,
    separatorMicrons: 460,
    cuttingTool: '12格模具',
    templateKey: 'private/template.docx',
    sortOrder: 0,
    isActive: true,
    templates: [
      {
        id: 'template-1',
        groupId: 'group-1',
        versionNo: 1,
        originalName: 'A4-5x5-12.docx',
        status: 'ACTIVE',
        createdAt: '2026-09-30T00:00:00Z'
      }
    ],
    rules: skus.slice(0, 2).map((item, index) => ({
      id: `rule-${item.id}`,
      groupId: 'group-1',
      skuId: item.id,
      pagesPerUnit: index + 1,
      sortOrder: index,
      isActive: true,
      sku: item
    }))
  },
  {
    id: 'group-2',
    code: 'PCG-002',
    name: '备用 5×5 单页16帧',
    size: '5×5cm',
    paperSize: 'A4',
    paperType: '测试打印纸',
    orientation: 'PORTRAIT',
    frameWidthMm: 50,
    frameHeightMm: 50,
    framesPerSheet: 16,
    renderDpi: 300,
    separatorMicrons: 460,
    cuttingTool: null,
    templateKey: null,
    sortOrder: 1,
    isActive: false,
    templates: [],
    rules: []
  }
]

async function fulfill(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    json: { success: status < 400, data, message: status < 400 ? '操作成功' : '模拟网络失败' }
  })
}
async function mockPage(page: Page, role = 'OWNER', failWrites = false) {
  const writes: Array<{ path: string; method: string; body: unknown; key: string | null }> = []
  const draftWrites: string[] = []
  let groupAttempts = 0,
    templateAttempts = 0
  await page.addInitScript(() => localStorage.setItem('mowo_token', 'print-test-token'))
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname,
      method = request.method()
    if (path === '/api/v1/account/me')
      return fulfill(route, {
        id: 'owner-1',
        staffRole: role,
        role: role === 'OWNER' ? 3 : 2,
        status: 'ACTIVE',
        profile: { nickname: '负责人' }
      })
    if (path === '/api/config/features') return fulfill(route, {})
    if (/draft|custom-products|customization-requests/.test(path) && method !== 'GET')
      draftWrites.push(path)
    if (path === '/api/admin/print-production/' && method === 'GET')
      return fulfill(route, { groups, skus })
    if (path.startsWith('/api/admin/print-production') && method !== 'GET') {
      const contentType = request.headers()['content-type'] || ''
      const body = contentType.includes('application/json') ? request.postDataJSON() : 'multipart'
      writes.push({ path, method, body, key: request.headers()['idempotency-key'] || null })
      if (path === '/api/admin/print-production/groups' && method === 'POST') {
        groupAttempts++
        if (failWrites && groupAttempts === 1) return fulfill(route, null, 503)
        return fulfill(
          route,
          { ...groups[0], id: 'group-created', reused: groupAttempts > 1 },
          groupAttempts > 1 ? 200 : 201
        )
      }
      if (/\/templates$/.test(path)) {
        templateAttempts++
        if (failWrites && templateAttempts === 1) return fulfill(route, null, 503)
        return fulfill(
          route,
          { ...groups[0]!.templates[0], reused: templateAttempts > 1 },
          templateAttempts > 1 ? 200 : 201
        )
      }
      return fulfill(route, {})
    }
    throw new Error(`Unexpected request: ${method} ${path}`)
  })
  return { writes, draftWrites }
}

async function geometry(page: Page) {
  return page.evaluate(() => {
    const box = (selector: string) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect()
      return rect ? { x: rect.x, y: rect.y, width: rect.width } : null
    }
    return {
      topbar: box('.topbar'),
      content: box('.content'),
      summary: box('.summary'),
      group: box('.group')
    }
  })
}

async function drag(page: Page, sourceSelector: string, targetSelector: string) {
  await page.evaluate(
    ({ sourceSelector, targetSelector }) => {
      const source = document.querySelector(sourceSelector)
      const target = document.querySelector(targetSelector)
      if (!(source instanceof HTMLElement) || !(target instanceof HTMLElement))
        throw new Error(`Missing drag target: ${sourceSelector} -> ${targetSelector}`)
      const dataTransfer = new DataTransfer()
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }))
      target.dispatchEvent(
        new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer })
      )
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
      source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }))
    },
    { sourceSelector, targetSelector }
  )
}

test('print candidate preserves layout, summary, template and safe SKU rendering', async ({
  page
}, info) => {
  const tracked = await mockPage(page)
  await page.goto('/app/admin/print-production')
  await expect(page.getByRole('heading', { name: '打印与裁切设置' })).toBeVisible()
  await expect(page.getByText('A4-5x5-12.docx · V1')).toBeVisible()
  await expect(page.getByText('<img src=x onerror=alert(1)>宝盒款 · SKU-002')).toBeVisible()
  await expect(page.locator('img[src^="javascript:"]')).toHaveCount(0)
  await expect(page.locator('.metric strong')).toHaveText(['1', '2', '1'])
  expect(tracked.draftWrites).toHaveLength(0)
  if (info.project.name === 'mobile-chromium') {
    await page.getByRole('button', { name: '☰' }).click()
    await expect(page.getByRole('navigation', { name: '后台菜单' })).toBeVisible()
  } else {
    const candidate = await geometry(page)
    await page.goto('http://127.0.0.1:5500/mowo/frontend/pages/admin-print-production.html')
    await expect(page.getByText('A4-5x5-12.docx · V1')).toBeVisible()
    const legacy = await geometry(page)
    for (const key of ['topbar', 'content', 'summary', 'group'] as const) {
      expect(candidate[key]).not.toBeNull()
      expect(legacy[key]).not.toBeNull()
      for (const field of ['x', 'y', 'width'] as const)
        expect(Math.abs(candidate[key]![field] - legacy[key]![field])).toBeLessThanOrEqual(6)
    }
  }
})

test('group and template retries keep stable idempotency keys and never write drafts', async ({
  page
}) => {
  const tracked = await mockPage(page, 'OWNER', true)
  await page.goto('/app/admin/print-production')
  await page.getByRole('button', { name: '新增打印裁切组' }).click()
  await page.getByLabel('组名').fill('新打印组')
  await page.getByLabel('每页容纳帧数').fill('12')
  await page.getByLabel('成品宽度（毫米）').fill('50')
  await page.getByLabel('成品高度（毫米）').fill('50')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByRole('dialog', { name: '新增打印裁切组' })).toBeVisible()
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByRole('dialog', { name: '新增打印裁切组' })).toHaveCount(0)
  await expect(page.getByText('已恢复此前创建成功的打印裁切组')).toBeVisible()
  const groupWrites = tracked.writes.filter(
    (row) => row.path.endsWith('/groups') && row.method === 'POST'
  )
  expect(groupWrites).toHaveLength(2)
  expect((groupWrites[0]!.body as Record<string, unknown>).clientRequestId).toBe(
    (groupWrites[1]!.body as Record<string, unknown>).clientRequestId
  )

  await page.locator('[data-group-id="group-1"]').getByRole('button', { name: '上传模板' }).click()
  await page.getByLabel('一页模板（.docx）').setInputFiles({
    name: 'template.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from('test-template')
  })
  await page.getByRole('button', { name: '上传并启用' }).click()
  await expect(page.getByText('模拟网络失败')).toBeVisible()
  await page.getByRole('button', { name: '上传并启用' }).click()
  const templateWrites = tracked.writes.filter((row) => row.path.endsWith('/templates'))
  expect(templateWrites).toHaveLength(2)
  expect(templateWrites[0]!.key).toBe(templateWrites[1]!.key)
  expect(templateWrites[0]!.key).toMatch(/^print-template-/)
  expect(tracked.draftWrites).toHaveLength(0)
})

test('SKU filters, add, two-level drag, move and removal preserve original endpoints', async ({
  page
}) => {
  const tracked = await mockPage(page)
  page.on('dialog', (dialog) => dialog.accept())
  await page.goto('/app/admin/print-production')
  const group1 = page.locator('[data-group-id="group-1"]')
  await group1.getByRole('button', { name: '添加 SKU' }).click()
  const skuDialog = page.getByRole('dialog', { name: '添加 SKU' })
  await page.getByLabel('材质筛选').selectOption('亚克力')
  await expect(skuDialog.getByText('基础款 · SKU-003')).toBeVisible()
  await skuDialog.getByText('基础款 · SKU-003').click()
  await page.getByRole('button', { name: '添加所选 SKU' }).click()
  await expect(page.locator('[data-group-id="group-1"]')).toBeVisible()
  await expect(page.locator('[data-group-id="group-2"]')).toBeVisible()
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/groups/reorder')),
    drag(page, '[data-group-id="group-2"]', '[data-group-id="group-1"]')
  ])
  await expect(page.locator('[data-rule-id="rule-sku-1"]')).toBeVisible()
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/rules/reorder')),
    drag(page, '[data-rule-id="rule-sku-1"]', '[data-rule-id="rule-sku-2"]')
  ])
  await expect(page.locator('[data-rule-id="rule-sku-1"]')).toBeVisible()
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/rule-sku-1/move')),
    drag(page, '[data-rule-id="rule-sku-1"]', '[data-group-id="group-2"] .sku-list')
  ])
  await expect(page.locator('[data-rule-id="rule-sku-1"]')).toBeVisible()
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' && response.url().endsWith('/rule-sku-1')
    ),
    drag(page, '[data-rule-id="rule-sku-1"]', '.unassigned')
  ])
  const paths = tracked.writes.map((row) => `${row.method} ${row.path}`)
  expect(paths).toContain('POST /api/admin/print-production/rules')
  expect(paths).toContain('PUT /api/admin/print-production/groups/reorder')
  expect(paths).toContain('PUT /api/admin/print-production/rules/reorder')
  expect(paths).toContain('PUT /api/admin/print-production/rules/rule-sku-1/move')
  expect(paths).toContain('DELETE /api/admin/print-production/rules/rule-sku-1')
  expect(tracked.draftWrites).toHaveLength(0)
})

test('non-owner staff cannot render or query global print settings', async ({ page }) => {
  const tracked = await mockPage(page, 'PRODUCTION')
  await page.goto('/app/admin/print-production')
  await expect(page).toHaveURL(/\/app\/forbidden$/)
  expect(tracked.writes).toHaveLength(0)
  expect(tracked.draftWrites).toHaveLength(0)
})
