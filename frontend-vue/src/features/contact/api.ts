import { runtimeConfig } from '@/config/runtime'
import { apiRequest } from '@/services/api-client'
import type { ContactFilePurpose, ContactPayload } from './types'

const UPLOAD_SESSION_KEY = 'mowo_contact_upload_session'
const UPLOAD_TIMEOUT_MS = 90_000
let memoryUploadSession = ''

interface PresignResult {
  fileId: string
  uploadUrl: string
  objectKey: string
  completeUrl: string
  purpose: string
  maxBytes: number
}

function randomSession(): string {
  return crypto.randomUUID()
}

export function contactUploadSession(): string {
  try {
    const stored = sessionStorage.getItem(UPLOAD_SESSION_KEY)
    if (stored) return stored
    const created = randomSession()
    sessionStorage.setItem(UPLOAD_SESSION_KEY, created)
    return created
  } catch {
    if (!memoryUploadSession) memoryUploadSession = randomSession()
    return memoryUploadSession
  }
}

function uploadHeaders(session: string): HeadersInit {
  return { 'X-Upload-Session': session }
}

function apiOrigin(): string {
  return new URL(runtimeConfig.apiBase || window.location.origin, window.location.origin).origin
}

function completionPath(value: string): string {
  let url: URL
  try {
    url = new URL(value, window.location.origin)
  } catch {
    throw new Error('服务器返回的文件确认地址无效')
  }
  if (url.origin !== apiOrigin() || !/^\/api\/upload\/files\/[^/]+\/complete$/.test(url.pathname)) {
    throw new Error('服务器返回的文件确认地址不受信任')
  }
  return `${url.pathname}${url.search}`
}

function validatePresign(value: unknown, purpose: ContactFilePurpose): PresignResult {
  if (!value || typeof value !== 'object') throw new Error('服务器返回的上传信息无效')
  const row = value as Partial<PresignResult>
  if (
    typeof row.fileId !== 'string' ||
    typeof row.uploadUrl !== 'string' ||
    typeof row.objectKey !== 'string' ||
    typeof row.completeUrl !== 'string' ||
    row.purpose !== purpose ||
    typeof row.maxBytes !== 'number'
  ) {
    throw new Error('服务器返回的上传信息不完整')
  }
  const uploadUrl = new URL(row.uploadUrl, window.location.origin)
  if (!['http:', 'https:'].includes(uploadUrl.protocol)) {
    throw new Error('服务器返回的上传地址不受信任')
  }
  return row as PresignResult
}

export async function uploadContactFile(
  file: File,
  purpose: ContactFilePurpose,
  session = contactUploadSession()
): Promise<string> {
  const raw = await apiRequest<unknown>('/api/upload/presign', {
    method: 'POST',
    headers: uploadHeaders(session),
    body: {
      purpose,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size
    }
  })
  const presign = validatePresign(raw, purpose)
  if (file.size > presign.maxBytes) throw new Error(`${file.name} 超过服务端允许大小`)

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS)
  try {
    const response = await fetch(new URL(presign.uploadUrl, window.location.origin), {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
      credentials: 'omit',
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`${file.name} 上传失败`)
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw new Error(`${file.name} 上传超时`, { cause })
    }
    if (cause instanceof Error) throw cause
    throw new Error(`${file.name} 上传失败`, { cause })
  } finally {
    window.clearTimeout(timeout)
  }

  await apiRequest(completionPath(presign.completeUrl), {
    method: 'POST',
    headers: uploadHeaders(session),
    timeoutMs: 30_000
  })
  return presign.objectKey
}

export async function submitContact(
  payload: ContactPayload,
  session = contactUploadSession()
): Promise<void> {
  await apiRequest('/api/contact', {
    method: 'POST',
    headers: uploadHeaders(session),
    body: { ...payload },
    retryAuth: true
  })
}

export function resetContactUploadSessionForTests(): void {
  memoryUploadSession = ''
  try {
    sessionStorage.removeItem(UPLOAD_SESSION_KEY)
  } catch {
    // Storage can be unavailable in hardened browser contexts.
  }
}
