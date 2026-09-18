export type EditorMode =
  | 'new-customization'
  | 'draft-edit'
  | 'asset-version'
  | 'customer-review'
  | 'staff-review'
  | 'frame-library'

export type EditorStaffRole = 'OWNER' | 'PRODUCTION' | 'CUSTOMER_SERVICE' | null

export interface EditorEntry {
  mode: EditorMode
  resourceId: string | null
  modelId: string | null
}

export interface EditorCapabilities {
  canUpload: boolean
  canMutateFrames: boolean
  canChangeSelection: boolean
  canSubmitHumanRequest: boolean
  canSubmitRevision: boolean
  canSaveVersion: boolean
  canAutoSave: boolean
  canPublishLibraryAsset: boolean
}

export interface EditorFrame {
  id: string
  source: string
  objectKey: string | null
  selected: boolean
  clonedFromId: string | null
}

export interface EditorSnapshot {
  frames: EditorFrame[]
  cursorId: string | null
}

export interface EditorState extends EditorSnapshot {
  undo: EditorSnapshot[]
  nextFrameNumber: number
}
