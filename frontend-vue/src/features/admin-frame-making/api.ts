import { apiRequest } from '@/services/api-client'
import { uploadRegisteredPrivateFile } from '@/services/private-upload'

export type FrameDraftStatus = 'DRAFT' | 'READY_FOR_REVIEW' | 'PUBLISHED' | 'ABANDONED'
export type FrameSourceType = 'VIDEO' | 'GIF' | 'IMAGES'

export interface FrameDraftListItem {
  id: string
  draftNo: string
  status: FrameDraftStatus
  title: string
  sourceType: FrameSourceType
  sourceCount: number
  targetRatio: string
  updatedAt: string
  createdAt: string
  creatorName: string
  editorName: string
  animationAsset: { id: string; assetNo: string } | null
}

export interface FrameDraftSource {
  index: number
  name: string
  type: string
  size: number
  url: string
}

export interface FrameDraftDetail extends Omit<FrameDraftListItem, 'sourceCount'> {
  revision: number
  createdByStaffId: string
  lastEditedByStaffId: string
  sources: FrameDraftSource[]
  sourceMetadata: Record<string, unknown> | null
  editorData: Record<string, unknown> | null
  sourceChannel: string
  usageType: string
  rightsHolderType: string
  rightsHolderName: string | null
  rightsHolderContact: string | null
  authorizationStatus: string
  tags: string[] | null
  internalNotes: string | null
}

export interface DraftPatch {
  revision: number
  title?: string
  targetRatio?: string
  sourceChannel?: string
  usageType?: string
  rightsHolderType?: string
  rightsHolderName?: string
  rightsHolderContact?: string
  authorizationStatus?: string
  ownerPhone?: string
  tags?: string[]
  internalNotes?: string
  editorData?: Record<string, unknown>
  sourceMetadata?: Record<string, unknown>
}

export function listFrameDrafts(status: FrameDraftStatus): Promise<FrameDraftListItem[]> {
  return apiRequest(`/api/admin/frame-making/drafts?status=${encodeURIComponent(status)}`)
}

export function getFrameDraft(id: string): Promise<FrameDraftDetail> {
  return apiRequest(`/api/admin/frame-making/drafts/${encodeURIComponent(id)}`)
}

export function createFrameDraft(input: {
  clientRequestId: string
  sourceKeys: string[]
  sourceType: FrameSourceType
  targetRatio: string
  title: string
  sourceMetadata: Record<string, unknown>
}): Promise<{ id: string; draftNo: string; revision: number }> {
  return apiRequest('/api/admin/frame-making/drafts', { method: 'POST', body: input })
}

export function updateFrameDraft(
  id: string,
  input: DraftPatch
): Promise<{ id: string; revision: number; updatedAt: string }> {
  return apiRequest(`/api/admin/frame-making/drafts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { ...input }
  })
}

export function abandonFrameDraft(id: string): Promise<void> {
  return apiRequest(`/api/admin/frame-making/drafts/${encodeURIComponent(id)}/abandon`, {
    method: 'POST',
    body: {}
  })
}

export function submitFrameDraft(
  id: string,
  revision: number
): Promise<{ status: FrameDraftStatus; revision: number; updatedAt: string }> {
  return apiRequest(`/api/admin/frame-making/drafts/${encodeURIComponent(id)}/submit-review`, {
    method: 'POST',
    body: { revision }
  })
}

export function publishFrameDraft(
  id: string,
  frameKeys: string[]
): Promise<{ id: string; assetNo: string; versionNo: number }> {
  return apiRequest(`/api/admin/frame-making/drafts/${encodeURIComponent(id)}/publish`, {
    method: 'POST',
    body: { frameKeys }
  })
}

export function uploadFrameMakingFile(
  file: File,
  purpose: 'LIBRARY_SOURCE' | 'LIBRARY_FRAME'
): Promise<string> {
  return uploadRegisteredPrivateFile(file, purpose)
}
