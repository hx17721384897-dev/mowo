import { runtimeConfig } from '@/config/runtime'
import { apiRequest } from '@/services/api-client'

interface AvatarPresign {
  fileId: string
  uploadUrl: string
  completeUrl: string
}

function apiOrigin(): string {
  return new URL(runtimeConfig.apiBase || window.location.origin, window.location.origin).origin
}

function completionPath(value: string): string {
  const url = new URL(value, window.location.origin)
  if (url.origin !== apiOrigin() || !/^\/api\/upload\/files\/[^/]+\/complete$/.test(url.pathname)) {
    throw new Error('服务器返回的头像确认地址不受信任')
  }
  return `${url.pathname}${url.search}`
}

function validatePresign(value: unknown): AvatarPresign {
  if (!value || typeof value !== 'object') throw new Error('服务器返回的头像上传信息无效')
  const row = value as Partial<AvatarPresign>
  if (
    typeof row.fileId !== 'string' ||
    typeof row.uploadUrl !== 'string' ||
    typeof row.completeUrl !== 'string'
  ) {
    throw new Error('服务器返回的头像上传信息不完整')
  }
  const uploadUrl = new URL(row.uploadUrl, window.location.origin)
  if (!['http:', 'https:'].includes(uploadUrl.protocol)) {
    throw new Error('服务器返回的头像上传地址不受信任')
  }
  return row as AvatarPresign
}

export async function uploadAvatar(blob: Blob): Promise<string> {
  const presign = validatePresign(
    await apiRequest('/api/upload/presign-avatar', {
      method: 'POST',
      body: { fileType: 'image/jpeg', fileSize: blob.size }
    })
  )
  const upload = await fetch(new URL(presign.uploadUrl, window.location.origin), {
    method: 'PUT',
    body: blob,
    headers: { 'Content-Type': 'image/jpeg' },
    credentials: 'omit'
  })
  if (!upload.ok) throw new Error('头像上传失败')
  await apiRequest(completionPath(presign.completeUrl), { method: 'POST' })
  const adopted = await apiRequest<{ avatarUrl?: string }>(
    `/api/upload/files/${encodeURIComponent(presign.fileId)}/use-as-avatar`,
    { method: 'POST' }
  )
  if (!adopted.avatarUrl) throw new Error('头像更新响应格式不正确')
  return adopted.avatarUrl
}
