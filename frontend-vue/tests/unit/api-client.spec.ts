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
})
