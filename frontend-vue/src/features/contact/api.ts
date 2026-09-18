import { apiRequest } from '@/services/api-client'
import { uploadRegisteredPrivateFile } from '@/services/private-upload'
import type { ContactFilePurpose, ContactPayload } from './types'

const UPLOAD_SESSION_KEY = 'mowo_contact_upload_session'
let memoryUploadSession = ''

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

export async function uploadContactFile(
  file: File,
  purpose: ContactFilePurpose,
  session = contactUploadSession()
): Promise<string> {
  return uploadRegisteredPrivateFile(file, purpose, {
    headers: uploadHeaders(session)
  })
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
