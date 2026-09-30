import { runtimeConfig } from '@/config/runtime'
import { clearSession, readAccessToken, saveAccessToken } from './auth-session'

const DEFAULT_TIMEOUT_MS = 10_000
const REFRESHABLE_AUTH_CODES = new Set([
  'AUTH_REQUIRED',
  'SESSION_REQUIRED',
  'SESSION_REVOKED',
  'UNAUTHORIZED'
])
let refreshPromise: Promise<string | null> | null = null

export interface ApiEnvelope<T> {
  success: boolean
  data?: T
  meta?: unknown
  code?: string
  message?: string
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId: string,
    override readonly cause?: unknown,
    readonly details?: unknown
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: BodyInit | Record<string, unknown> | null
  timeoutMs?: number
  retryAuth?: boolean
}

export async function apiEnvelopeRequest<T, M = unknown>(
  path: string,
  options: RequestOptions = {}
): Promise<{ data: T; meta: M }> {
  const url = endpoint(path)
  const requestId = crypto.randomUUID()
  const controller = new AbortController()
  const timeout = window.setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  )
  const token = readAccessToken()
  const isJsonBody =
    options.body != null && !(options.body instanceof FormData) && typeof options.body !== 'string'
  const body = isJsonBody
    ? JSON.stringify(options.body)
    : (options.body as BodyInit | null | undefined)
  try {
    const response = await fetch(url, {
      ...options,
      body,
      credentials: 'include',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'X-Request-Id': requestId,
        ...(isJsonBody ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers
      }
    })
    const envelope = await parseEnvelope<T>(response, requestId)
    if (
      response.status === 401 &&
      options.retryAuth !== false &&
      REFRESHABLE_AUTH_CODES.has(envelope.code ?? '')
    ) {
      const refreshedToken = await refreshAccessToken()
      if (refreshedToken) return apiEnvelopeRequest<T, M>(path, { ...options, retryAuth: false })
      clearSession()
    }
    if (!response.ok || !envelope.success)
      throw new ApiError(
        envelope.message || '请求失败',
        response.status,
        envelope.code || 'REQUEST_FAILED',
        requestId,
        undefined,
        envelope.data
      )
    return { data: envelope.data as T, meta: envelope.meta as M }
  } catch (cause) {
    if (cause instanceof ApiError) throw cause
    const code =
      cause instanceof DOMException && cause.name === 'AbortError'
        ? 'REQUEST_TIMEOUT'
        : 'NETWORK_ERROR'
    throw new ApiError(
      code === 'REQUEST_TIMEOUT' ? '请求超时' : '网络连接失败',
      0,
      code,
      requestId,
      cause
    )
  } finally {
    window.clearTimeout(timeout)
  }
}

function endpoint(path: string): string {
  if (!path.startsWith('/api/')) throw new Error('API 请求路径必须以 /api/ 开头')
  return `${runtimeConfig.apiBase}${path}`
}

async function parseEnvelope<T>(response: Response, requestId: string): Promise<ApiEnvelope<T>> {
  const raw = await response.text()
  if (!raw) return { success: response.ok }
  try {
    return JSON.parse(raw) as ApiEnvelope<T>
  } catch (cause) {
    throw new ApiError(
      '服务器返回了无法解析的数据',
      response.status,
      'INVALID_JSON',
      requestId,
      cause
    )
  }
}

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const response = await fetch(endpoint('/api/v1/auth/refresh'), {
          method: 'POST',
          credentials: 'include',
          headers: { Accept: 'application/json' }
        })
        if (!response.ok) return null
        const body = await parseEnvelope<{ accessToken?: string; token?: string }>(
          response,
          crypto.randomUUID()
        )
        const token = body.data?.accessToken ?? body.data?.token ?? null
        if (token) saveAccessToken(token)
        return token
      } catch {
        return null
      } finally {
        refreshPromise = null
      }
    })()
  }
  return refreshPromise
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = endpoint(path)
  const requestId = crypto.randomUUID()
  const controller = new AbortController()
  const timeout = window.setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  )
  const token = readAccessToken()
  const isJsonBody =
    options.body != null && !(options.body instanceof FormData) && typeof options.body !== 'string'
  const body = isJsonBody
    ? JSON.stringify(options.body)
    : (options.body as BodyInit | null | undefined)

  try {
    const response = await fetch(url, {
      ...options,
      body,
      credentials: 'include',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'X-Request-Id': requestId,
        ...(isJsonBody ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers
      }
    })

    const envelope = await parseEnvelope<T>(response, requestId)

    if (
      response.status === 401 &&
      options.retryAuth !== false &&
      REFRESHABLE_AUTH_CODES.has(envelope.code ?? '')
    ) {
      const refreshedToken = await refreshAccessToken()
      if (refreshedToken) return apiRequest<T>(path, { ...options, retryAuth: false })
      clearSession()
    }

    if (!response.ok || !envelope.success) {
      throw new ApiError(
        envelope.message || '请求失败',
        response.status,
        envelope.code || 'REQUEST_FAILED',
        requestId,
        undefined,
        envelope.data
      )
    }
    return envelope.data as T
  } catch (cause) {
    if (cause instanceof ApiError) throw cause
    const code =
      cause instanceof DOMException && cause.name === 'AbortError'
        ? 'REQUEST_TIMEOUT'
        : 'NETWORK_ERROR'
    throw new ApiError(
      code === 'REQUEST_TIMEOUT' ? '请求超时' : '网络连接失败',
      0,
      code,
      requestId,
      cause
    )
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function apiBlobRequest(
  path: string,
  options: Omit<RequestOptions, 'body'> = {}
): Promise<Blob> {
  const url = endpoint(path)
  const requestId = crypto.randomUUID()
  const controller = new AbortController()
  const timeout = window.setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  )
  const token = readAccessToken()

  try {
    const response = await fetch(url, {
      ...options,
      credentials: 'include',
      signal: controller.signal,
      headers: {
        Accept: 'application/octet-stream, application/json',
        'X-Request-Id': requestId,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers
      }
    })
    if (response.ok) return response.blob()

    const envelope = await parseEnvelope<unknown>(response, requestId)
    if (
      response.status === 401 &&
      options.retryAuth !== false &&
      REFRESHABLE_AUTH_CODES.has(envelope.code ?? '')
    ) {
      const refreshedToken = await refreshAccessToken()
      if (refreshedToken) return apiBlobRequest(path, { ...options, retryAuth: false })
      clearSession()
    }
    throw new ApiError(
      envelope.message || '文件生成失败',
      response.status,
      envelope.code || 'REQUEST_FAILED',
      requestId,
      undefined,
      envelope.data
    )
  } catch (cause) {
    if (cause instanceof ApiError) throw cause
    const code =
      cause instanceof DOMException && cause.name === 'AbortError'
        ? 'REQUEST_TIMEOUT'
        : 'NETWORK_ERROR'
    throw new ApiError(
      code === 'REQUEST_TIMEOUT' ? '文件生成超时' : '网络连接失败',
      0,
      code,
      requestId,
      cause
    )
  } finally {
    window.clearTimeout(timeout)
  }
}

export function resetRefreshStateForTests(): void {
  refreshPromise = null
}
