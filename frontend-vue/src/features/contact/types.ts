export type ContactType = 'artist' | 'channel' | 'media' | 'join' | 'feedback' | 'factory'

export type ContactFieldKind =
  'text' | 'email' | 'url' | 'textarea' | 'select' | 'checkbox' | 'file'

export interface ContactField {
  name: string
  label: string
  kind: ContactFieldKind
  required?: boolean
  placeholder?: string
  options?: string[]
  accept?: string
  multiple?: boolean
  hint?: string
  minHeight?: number
}

export interface ContactDefinition {
  type: ContactType
  icon: string
  cardTitle: string
  cardSubtitle: string
  cardAction: string
  modalTitle: string
  modalSubtitle: string
  description: string
  rows: ContactField[][]
  submitLabel: string
  formNote: string
  successIcon: string
  successTitle: string
  successBody: string
  successClose: string
}

export type ContactValue = string | boolean | File[]
export type ContactValues = Record<string, ContactValue>

export interface ContactPayload {
  type: ContactType
  name: string
  contact: string
  message: string
  extra?: Record<string, string | boolean>
  attachments?: string[]
}

export type ContactFilePurpose = 'CONTACT_PORTFOLIO' | 'CONTACT_RESUME'
