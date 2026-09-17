import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetRefreshStateForTests } from '@/services/api-client'
import { ACCESS_TOKEN_KEY, USER_CACHE_KEY } from '@/services/auth-session'
import { useSessionStore } from '@/stores/session'

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

describe('session bootstrap', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetRefreshStateForTests()
    localStorage.setItem(ACCESS_TOKEN_KEY, 'test-token')
    localStorage.setItem(USER_CACHE_KEY, JSON.stringify({ id: 'stale-user' }))
  })

  it('replaces cached identity with the trusted account response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(200, {
          success: true,
          data: {
            id: 'trusted-user',
            maskedPhone: '138****0000',
            role: 0,
            staffRole: null,
            status: 'ACTIVE',
            profile: { nickname: '可信用户', notifyOrder: true }
          }
        })
      )
    )

    const session = useSessionStore()
    await session.bootstrap()

    expect(session.status).toBe('authenticated')
    expect(session.user?.id).toBe('trusted-user')
    expect(JSON.parse(localStorage.getItem(USER_CACHE_KEY) || '{}').id).toBe('trusted-user')
  })

  it('clears local identity when both access and refresh sessions are rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(401, { success: false, code: 'UNAUTHORIZED' }))
    )

    const session = useSessionStore()
    await session.bootstrap()

    expect(session.status).toBe('anonymous')
    expect(session.user).toBeNull()
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull()
    expect(localStorage.getItem(USER_CACHE_KEY)).toBeNull()
  })

  it('does not trust cached identity when account verification is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('offline')))
    )

    const session = useSessionStore()
    await session.bootstrap()

    expect(session.status).toBe('unavailable')
    expect(session.isAuthenticated).toBe(false)
    expect(session.user?.id).toBe('stale-user')
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('test-token')
  })
})
