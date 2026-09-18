import { runtimeConfig } from '@/config/runtime'
import { apiRequest } from './api-client'

const DEFAULT_UPLOAD_TIMEOUT_MS = 90_000

interface PresignResult {
  fileId: string
  uploadUrl: string
  objectKey: string
  completeUrl: string
  purpose: string
  maxBytes: number
}

export interface PrivateUploadOptions {
  headers?: HeadersInit
  timeoutMs?: number
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

function validatePresign(value: unknown, purpose: string): PresignResult {
  if (!value || typeof value !== 'object') throw new Error('服务器返回的上传信息无效')
  const row = value as Partial<PresignResult>
  if (
    typeof row.fileId !== 'string' ||
    row.fileId.trim() === '' ||
    typeof row.uploadUrl !== 'string' ||
    row.uploadUrl.trim() === '' ||
    typeof row.objectKey !== 'string' ||
    row.objectKey.trim() === '' ||
    typeof row.completeUrl !== 'string' ||
    row.completeUrl.trim() === '' ||
    row.purpose !== purpose ||
    typeof row.maxBytes !== 'number' ||
    !Number.isFinite(row.maxBytes) ||
    row.maxBytes <= 0
  ) {
    throw new Error('服务器返回的上传信息不完整')
  }
  let uploadUrl: URL
  try {
    uploadUrl = new URL(row.uploadUrl, window.location.origin)
  } catch {
    throw new Error('服务器返回的上传地址无效')
  }
  if (!['http:', 'https:'].includes(uploadUrl.protocol)) {
    throw new Error('服务器返回的上传地址不受信任')
  }
  return row as PresignResult
}

export async function uploadRegisteredPrivateFile(
  file: File,
  purpose: string,
  options: PrivateUploadOptions = {}
): Promise<string> {
  const raw = await apiRequest<unknown>('/api/upload/presign', {
    method: 'POST',
    headers: options.headers,
    body: {
      purpose,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size
    }
  })
  const presign = validatePresign(raw, purpose)
  const trustedCompletionPath = completionPath(presign.completeUrl)
  if (file.size > presign.maxBytes) throw new Error(`${file.name} 超过服务端允许大小`)

  const controller = new AbortController()
  const timeout = window.setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS
  )
  try {
    const response = await fetch(new URL(presign.uploadUrl, window.location.origin), {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
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

  await apiRequest(trustedCompletionPath, {
    method: 'POST',
    headers: options.headers,
    timeoutMs: 30_000
  })
  return presign.objectKey
}
