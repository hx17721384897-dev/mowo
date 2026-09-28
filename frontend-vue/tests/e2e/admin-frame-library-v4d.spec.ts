import { expect, test, type Page, type Route } from '@playwright/test'

type Mutation = { method: string; path: string }

async function staff(page: Page, role = 'OWNER'): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('mowo_token', 'v4d-frame-library-test'))
  await page.route('**/api/v1/account/me', (route) =>
    route.fulfill({
      json: {
        success: true,
        data: { id: 'staff-1', staffRole: role, status: 'ACTIVE', profile: { nickname: '员工' } }
      }
    })
  )
}

function ok(route: Route, data: unknown = {}): Promise<void> {
  return route.fulfill({ json: { success: true, data } })
}

const asset = {
  id: 'asset-1',
  assetNo: 'ANM-0001',
  title: '<img src=x onerror=alert(1)>',
  sourceType: 'STAFF_CREATED',
  sourceChannel: 'OFFLINE_CUSTOM',
  usageType: 'PRIVATE_CUSTOM',
  assetType: 'PRIVATE',
  status: 'ACTIVE',
  collabStatus: 'NONE',
  rightsHolderType: 'OFFLINE_CUSTOMER',
  rightsHolderName: '测试客户',
  authorizationStatus: 'PRIVATE_ONLY',
  currentVersionNo: 1,
  baseFrameCount: 2,
  coverUrl: 'javascript:alert(2)',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
  owner: null,
  tags: [{ id: 'tag-1', name: '测试', color: null }],
  counts: { versions: 1, customizationRequests: 0, salesOrderItems: 0, collabWorks: 0 },
  productionFiles: [
    {
      id: 'file-1',
      displayName: '生产文件.docx',
      createdAt: '2026-09-03T00:00:00.000Z',
      downloadUrl: 'javascript:alert(3)',
      targetFrameCount: 12,
      fileVersionNo: 1,
      sourceType: 'MANUAL',
      productionBatchId: null,
      status: 'READY',
      animationVersionNo: 1,
      groupName: '标准组',
      templateVersionNo: 1,
      renderedFrameCount: 12,
      renderSize: '5x5cm',
      canDelete: true,
      deleteBlockedReason: null
    }
  ],
  canDelete: true
}

async function mockLibrary(page: Page, mutations: Mutation[], fullContact = true): Promise<void> {
  await page.route(/\/api\/admin\/frame-library(?:\/|$|\?)/, async (route) => {
    const request = route.request()
    const method = request.method()
    const url = new URL(request.url())
    const path = url.pathname
    if (method !== 'GET') mutations.push({ method, path })

    if (method === 'GET' && path === '/api/admin/frame-library/stats') {
      return ok(route, {
        all: 1,
        private: 1,
        collab: 0,
        company: 0,
        internal: 0,
        incomplete: 0,
        userDeleted: 0,
        archived: 0,
        tags: [{ id: 'tag-1', name: '测试', color: null, _count: { assets: 1 } }]
      })
    }
    if (method === 'GET' && path === '/api/admin/frame-library') {
      return ok(route, { items: [asset], total: 1, page: 1, limit: 24, hasMore: false })
    }
    if (method === 'GET' && path === '/api/admin/frame-library/asset-1') {
      return ok(route, {
        ...asset,
        rightsHolderContact: fullContact ? '13800138000' : null,
        rightsHolderContactMasked: '138****8000',
        internalNotes: '内部备注',
        createdByStaffName: '负责人',
        versions: [
          {
            id: 'version-1',
            versionNo: 1,
            sourceType: 'STAFF_CREATED',
            baseFrameCount: 2,
            manifestHash: 'hash',
            createdAt: '2026-09-01T00:00:00.000Z'
          }
        ],
        customizationRequests: [],
        salesOrderItems: [],
        collabWorks: [],
        _count: {
          customProducts: 0,
          versions: 1,
          customizationRequests: 0,
          salesOrderItems: 0,
          collabWorks: 0
        }
      })
    }
    if (method === 'GET' && path === '/api/admin/frame-library/asset-1/versions/1') {
      return ok(route, {
        id: 'version-1',
        versionNo: 1,
        sourceType: 'STAFF_CREATED',
        baseFrameCount: 2,
        manifestHash: 'hash',
        editorData: null,
        createdAt: '2026-09-01T00:00:00.000Z',
        frames: [
          { index: 1, url: 'data:image/png;base64,iVBORw0KGgo=' },
          { index: 2, url: 'javascript:alert(4)' }
        ]
      })
    }
    if (method === 'GET' && path === '/api/admin/frame-library/asset-1/production-options') {
      return ok(route, {
        versions: [{ id: 'version-1', versionNo: 1, baseFrameCount: 2 }],
        templates: [
          {
            id: 'template-1',
            templateVersionNo: 1,
            groupId: 'group-1',
            groupName: '标准组',
            size: '5x5cm',
            paperSize: 'A4',
            paperType: '哑光纸',
            orientation: 'portrait',
            framesPerSheet: 2,
            renderDpi: 300
          }
        ]
      })
    }
    if (method === 'POST' && path === '/api/admin/frame-library/asset-1/production-files') {
      await new Promise((resolve) => setTimeout(resolve, 80))
      return ok(route, { id: 'file-2', displayName: '新文件.docx', downloadUrl: null })
    }
    if (
      method === 'GET' &&
      path === '/api/admin/frame-library/asset-1/production-files/file-1/frames'
    ) {
      return ok(route, {
        fileId: 'file-1',
        displayName: '生产文件.docx',
        animationVersionNo: 1,
        size: '5x5cm',
        widthPx: 600,
        heightPx: 600,
        markerEnabled: true,
        frames: [{ index: 1, name: 'frame-001.png', url: 'javascript:alert(5)' }]
      })
    }
    if (method === 'PATCH' && path === '/api/admin/frame-library/asset-1') return ok(route, {})
    if (method === 'POST' && path.endsWith('/archive')) return ok(route)
    if (method === 'POST' && path.endsWith('/restore')) return ok(route)
    if (method === 'DELETE') return ok(route)
    return route.fulfill({ status: 404, json: { success: false, message: 'unexpected route' } })
  })
}

test('frame library candidate is read-only on load and preserves owner detail and production controls', async ({
  page
}) => {
  await staff(page)
  const mutations: Mutation[] = []
  await mockLibrary(page, mutations)

  await page.goto('/app/admin/frame-library')
  await expect(page.locator('.asset-card')).toHaveCount(1)
  await expect(page.getByText('<img src=x onerror=alert(1)>')).toBeVisible()
  await expect(page.locator('.asset-card .cover img')).toHaveCount(0)
  expect(mutations).toEqual([])

  await page.locator('.asset-card').click()
  await expect(page.locator('.detail-title')).toContainText('<img src=x onerror=alert(1)>')
  await expect(page.getByText('13800138000')).toBeVisible()
  await expect(page.locator('.frames .frame')).toHaveCount(2)
  await expect(page.locator('.frames .frame img')).toHaveCount(1)
  await expect(page.getByRole('button', { name: '编辑' })).toBeVisible()
  await expect(page.getByRole('button', { name: '归档', exact: true })).toBeVisible()
  expect(mutations).toEqual([])

  await page.getByRole('button', { name: '查看加工帧' }).click()
  await expect(page.getByText('frame-001.png')).toBeVisible()
  await expect(page.locator('.render-frame-card img')).toHaveCount(0)
  await page.getByRole('button', { name: '关闭' }).last().click()

  await page.getByRole('button', { name: '新增文件版本' }).click()
  await expect(page.getByText('找到 1 个兼容模板')).toBeVisible()
  expect(mutations).toEqual([])
  await page.getByRole('button', { name: '生成 Word 文件' }).dblclick()
  await expect
    .poll(() => mutations.filter((item) => item.path.endsWith('/production-files')).length)
    .toBe(1)
})

test('frame library candidate keeps collaboration operators read-only and masks contact data', async ({
  page
}) => {
  await staff(page, 'COLLAB_OPS')
  const mutations: Mutation[] = []
  await mockLibrary(page, mutations, false)
  await page.goto('/app/admin/frame-library')
  await page.locator('.asset-card').click()

  await expect(page.getByText('138****8000')).toBeVisible()
  await expect(page.getByText('13800138000')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '编辑' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '归档', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '新增文件版本' })).toHaveCount(0)
  expect(mutations).toEqual([])
})

test('frame library candidate rejects customer-service accounts', async ({ page }) => {
  await staff(page, 'CUSTOMER_SERVICE')
  await page.goto('/app/admin/frame-library')
  await expect(page).toHaveURL(/\/app\/forbidden$/)
})
