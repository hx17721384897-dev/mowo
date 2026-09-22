/* global localStorage, document */
import { chromium } from 'playwright'

const cases = [
  {
    key: 'users',
    old: 'admin-users.html',
    vue: 'users',
    selectors: [
      '.topbar',
      '.filter-tabs',
      '.search-wrap',
      '.table-wrap',
      '.table-header',
      '.user-row',
      '.pagination'
    ]
  },
  {
    key: 'deletions',
    old: 'admin-account-deletions.html',
    vue: 'account-deletions',
    selectors: [
      '.topbar',
      '.summary',
      '.toolbar',
      '.table-wrap',
      '.head',
      '.row:not(.head)',
      '.pagination'
    ]
  },
  {
    key: 'logs',
    old: 'admin-logs.html',
    vue: 'logs',
    selectors: ['.topbar', '.filter-bar', '.log-list', '.log-item', '.pagination']
  }
]
const browser = await chromium.launch({ headless: true })
try {
  for (const width of [1440, 700]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    await context.addInitScript(() => localStorage.setItem('mowo_token', 'visual-only-token'))
    const page = await context.newPage()
    await page.route('**/api/v1/account/me', (route) =>
      route.fulfill({
        json: {
          success: true,
          data: {
            id: 'visual-owner',
            role: 3,
            staffRole: 'OWNER',
            status: 'ACTIVE',
            profile: { nickname: '负责人' }
          }
        }
      })
    )
    await page.route('**/api/admin/users?*', (route) =>
      route.fulfill({
        json: {
          success: true,
          data: {
            users: [
              {
                id: 'visual-user',
                phone: '138****0001',
                role: 0,
                staffRole: null,
                isBanned: false,
                status: 'ACTIVE',
                createdAt: '2026-09-20T00:00:00.000Z',
                profile: { nickname: '测试用户', avatarUrl: null }
              }
            ],
            pagination: { page: 1, limit: 20, total: 1 }
          }
        }
      })
    )
    await page.route('**/api/admin/account-deletions?*', (route) =>
      route.fulfill({
        json: {
          success: true,
          data: {
            items: [
              {
                id: 'visual-task',
                userId: 'visual-user',
                user: { nickname: '测试用户', phone: '138****0001' },
                status: 'FAILED',
                requestedAt: '2026-09-20T00:00:00.000Z',
                elapsedHours: 12,
                attemptCount: 2,
                lastError: '测试异常',
                blockers: [],
                pauseReason: null,
                pauseUserMessage: null,
                protectionMinutesLeft: 0,
                canUserCancel: false,
                alertLevel: 'ATTENTION'
              }
            ],
            summary: { FAILED: 1 },
            canManage: true,
            pagination: { page: 1, limit: 20, total: 1 }
          }
        }
      })
    )
    await page.route('**/api/admin/logs?*', (route) =>
      route.fulfill({
        json: {
          success: true,
          data: {
            logs: [
              {
                id: 'visual-log',
                userId: 'visual-owner',
                userRole: 3,
                method: 'PUT',
                path: '/api/admin/users/visual-user/role',
                action: '修改员工岗位',
                outcome: 'SUCCESS',
                statusCode: 200,
                targetId: 'visual-user',
                before: '{"staffRole":null}',
                after: '{"staffRole":"PRODUCTION"}',
                ip: '127.0.0.1',
                createdAt: '2026-09-20T00:00:00.000Z',
                actor: { name: '负责人', maskedPhone: '177****4897', staffRole: 'OWNER' }
              }
            ],
            pagination: { page: 1, limit: 50, total: 1 }
          }
        }
      })
    )
    for (const item of cases) {
      const result = {}
      for (const [version, url] of [
        ['old', `http://127.0.0.1:5500/mowo/frontend/pages/${item.old}`],
        ['vue', `http://127.0.0.1:4173/app/admin/${item.vue}`]
      ]) {
        await page.goto(url, { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(600)
        result[version] = await page.evaluate(
          (selectors) =>
            Object.fromEntries(
              selectors.map((selector) => {
                const box = document.querySelector(selector)?.getBoundingClientRect()
                return [
                  selector,
                  box
                    ? {
                        x: Math.round(box.x),
                        y: Math.round(box.y),
                        w: Math.round(box.width),
                        h: Math.round(box.height)
                      }
                    : null
                ]
              })
            ),
          item.selectors
        )
        const action =
          item.key === 'users' ? '设岗位' : item.key === 'deletions' ? '暂停' : '展开详情'
        await page
          .getByRole('button', {
            name: item.key === 'logs' ? /^展开详情/ : action,
            exact: item.key !== 'logs'
          })
          .first()
          .click()
        const detailSelector =
          item.key === 'users'
            ? '.modal-overlay.show .modal'
            : item.key === 'deletions'
              ? '.modal-backdrop.show .modal'
              : '.log-detail.show'
        result[`${version}Detail`] = await page.evaluate((selector) => {
          const box = document.querySelector(selector)?.getBoundingClientRect()
          return box
            ? {
                x: Math.round(box.x),
                y: Math.round(box.y),
                w: Math.round(box.width),
                h: Math.round(box.height)
              }
            : null
        }, detailSelector)
      }
      console.log(JSON.stringify({ width, page: item.key, ...result }))
    }
    await context.close()
  }
} finally {
  await browser.close()
}
