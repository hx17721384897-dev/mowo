import { describe, expect, it } from 'vitest'
import { safeInternalRedirect } from '@/router/safe-redirect'

describe('safeInternalRedirect', () => {
  it('keeps internal paths including query and hash', () => {
    expect(safeInternalRedirect('/account/settings?tab=address#new')).toBe(
      '/account/settings?tab=address#new'
    )
  })

  it.each([
    'https://evil.example',
    '//evil.example/path',
    '/\\evil.example',
    'account/settings',
    '/account\n/settings'
  ])('rejects an unsafe redirect: %s', (value) => {
    expect(safeInternalRedirect(value)).toBe('/account')
  })
})
