import { expect, test } from '@playwright/test'

const legacyBase = 'http://127.0.0.1:5500/mowo/frontend/pages'

const redirects = [
  ['index.html', 'http://127.0.0.1:4173/app/'],
  ['about.html', 'http://127.0.0.1:4173/app/about'],
  ['products.html', 'http://127.0.0.1:4173/app/products'],
  ['faq.html', 'http://127.0.0.1:4173/app/faq'],
  ['user-agreement.html', 'http://127.0.0.1:4173/app/legal/terms'],
  ['privacy-policy.html', 'http://127.0.0.1:4173/app/legal/privacy'],
  ['admin-users.html', 'http://127.0.0.1:4173/app/admin/users'],
  ['admin-account-deletions.html', 'http://127.0.0.1:4173/app/admin/account-deletions'],
  ['admin-logs.html', 'http://127.0.0.1:4173/app/admin/logs'],
  ['production-inventory.html', 'http://127.0.0.1:4173/app/admin/inventory']
] as const

test('V6 deleted legacy pages only expose compatibility redirects', async ({ request }) => {
  for (const [legacy, target] of redirects) {
    const response = await request.get(`${legacyBase}/${legacy}?source=v6`, { maxRedirects: 0 })
    expect(response.status(), legacy).toBe(302)
    expect(response.headers().location, legacy).toBe(`${target}?source=v6`)
  }
})

test('V6 keeps only the reviewed admin frame-selection page', async ({ request }) => {
  const retained = await request.get(`${legacyBase}/customize-editor.html?adminRequestId=v6-check`)
  expect(retained.status()).toBe(200)

  const retiredArchive = await request.get(`${legacyBase}/_legacy/admin-production.html`)
  expect(retiredArchive.status()).toBe(404)
})
