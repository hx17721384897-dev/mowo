import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRequest, resetRefreshStateForTests } from '@/services/api-client'
import { ACCESS_TOKEN_KEY } from '@/services/auth-session'

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

describe('apiRequest', () => {
  beforeEach(() => {
    resetRefreshStateForTests()
    localStorage.setItem(ACCESS_TOKEN_KEY, 'expired-token')
  })

  it('deduplicates concurrent refreshes and retries each request once', async () => {
    let refreshCalls = 0
    const attempts = new Map<string, number>()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/api/v1/auth/refresh')) {
          refreshCalls += 1
          await Promise.resolve()
          return response(200, { success: true, data: { accessToken: 'fresh-token' } })
        }
        const count = attempts.get(url) ?? 0
        attempts.set(url, count + 1)
        return count === 0
          ? response(401, { success: false, code: 'UNAUTHORIZED' })
          : response(200, { success: true, data: { ok: true } })
      })
    )

    const [first, second] = await Promise.all([
      apiRequest<{ ok: boolean }>('/api/example-a'),
      apiRequest<{ ok: boolean }>('/api/example-b')
    ])

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(refreshCalls).toBe(1)
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('fresh-token')
  })

  it('rejects paths outside the API namespace', async () => {
    await expect(apiRequest('/retired-page')).rejects.toThrow('API 请求路径必须以 /api/ 开头')
  })

  it('can refresh an expired access token before an authenticated logout', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        calls.push(url)
        if (url.endsWith('/api/v1/auth/refresh')) {
          return response(200, { success: true, data: { accessToken: 'fresh-token' } })
        }
        const logoutAttempts = calls.filter((item) => item.endsWith('/api/v1/auth/logout')).length
        return logoutAttempts === 1
          ? response(401, { success: false, code: 'UNAUTHORIZED' })
          : response(200, { success: true })
      })
    )

    await apiRequest('/api/v1/auth/logout', { method: 'POST' })

    expect(calls.filter((url) => url.endsWith('/api/v1/auth/refresh'))).toHaveLength(1)
    expect(calls.filter((url) => url.endsWith('/api/v1/auth/logout'))).toHaveLength(2)
  })

  it('does not refresh endpoints that explicitly disable auth retries', async () => {
    const fetchMock = vi.fn(async () => response(401, { success: false, code: 'INVALID_CODE' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      apiRequest('/api/v1/auth/sms/verify', { method: 'POST', retryAuth: false })
    ).rejects.toMatchObject({ status: 401, code: 'INVALID_CODE' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not refresh or clear the session for a business-level 401', async () => {
    const fetchMock = vi.fn(async () =>
      response(401, { success: false, code: 'PASSWORD_INCORRECT', message: '密码错误' })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiRequest('/api/v1/account/password', { method: 'POST' })).rejects.toMatchObject({
      status: 401,
      code: 'PASSWORD_INCORRECT'
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('expired-token')
  })

  it('preserves structured business error details without exposing the raw envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(400, {
          success: false,
          code: 'CHECKOUT_VALIDATION_FAILED',
          message: '部分商品无法结算',
          data: { problems: [{ id: 'item-1', reason: '价格已变动' }] }
        })
      )
    )

    await expect(apiRequest('/api/cart/checkout', { method: 'POST' })).rejects.toMatchObject({
      status: 400,
      code: 'CHECKOUT_VALIDATION_FAILED',
      details: { problems: [{ id: 'item-1', reason: '价格已变动' }] }
    })
  })
})
