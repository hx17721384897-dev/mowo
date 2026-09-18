import type {
  EditorCapabilities,
  EditorEntry,
  EditorFrame,
  EditorMode,
  EditorSnapshot,
  EditorStaffRole,
  EditorState
} from './types'

const MODE_PARAMETERS = [
  ['draft-edit', ['editId', 'productId']],
  ['asset-version', ['assetId']],
  ['customer-review', ['reviewRequestId']],
  ['staff-review', ['adminRequestId']],
  ['frame-library', ['frameDraftId']]
] as const satisfies ReadonlyArray<readonly [EditorMode, readonly string[]]>

const MAX_UNDO = 30

export class EditorEntryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EditorEntryError'
  }
}

function queryValue(query: URLSearchParams, names: readonly string[]): string | null {
  for (const name of names) {
    const value = query.get(name)?.trim()
    if (value) return value
  }
  return null
}

export function resolveEditorEntry(query: URLSearchParams): EditorEntry {
  const matched = MODE_PARAMETERS.map(([mode, names]) => ({
    mode,
    resourceId: queryValue(query, names)
  })).filter((entry) => entry.resourceId)

  if (matched.length > 1) {
    throw new EditorEntryError('编辑器地址包含互相冲突的模式参数')
  }

  const modelId = query.get('modelId')?.trim() || null
  if (!matched.length) return { mode: 'new-customization', resourceId: null, modelId }
  const match = matched[0]!
  return { ...match, modelId }
}

export function capabilitiesForMode(
  mode: EditorMode,
  staffRole: EditorStaffRole = null
): EditorCapabilities {
  const editable = mode !== 'customer-review'
  return {
    canUpload: mode === 'new-customization' || mode === 'draft-edit',
    canMutateFrames: editable,
    canChangeSelection: editable,
    canSubmitHumanRequest: mode === 'new-customization',
    canSubmitRevision: mode === 'customer-review',
    canSaveVersion: mode === 'asset-version',
    canAutoSave: mode === 'staff-review' || mode === 'frame-library',
    canPublishLibraryAsset: mode === 'frame-library' && staffRole === 'OWNER'
  }
}

function cloneFrames(frames: EditorFrame[]): EditorFrame[] {
  return frames.map((frame) => ({ ...frame }))
}

function snapshot(state: EditorState): EditorSnapshot {
  return { frames: cloneFrames(state.frames), cursorId: state.cursorId }
}

function withUndo(state: EditorState): EditorState {
  return {
    ...state,
    frames: cloneFrames(state.frames),
    undo: [...state.undo, snapshot(state)].slice(-MAX_UNDO)
  }
}

function normalizeCursor(state: EditorState): EditorState {
  if (state.cursorId && state.frames.some((frame) => frame.id === state.cursorId)) return state
  return { ...state, cursorId: state.frames.find((frame) => frame.selected)?.id ?? null }
}

export function createEditorState(
  frames: Array<{ source: string; objectKey?: string | null; selected?: boolean }>
): EditorState {
  const mapped = frames.map((frame, index) => ({
    id: `frame-${index + 1}`,
    source: frame.source,
    objectKey: frame.objectKey ?? null,
    selected: frame.selected !== false,
    clonedFromId: null
  }))
  return {
    frames: mapped,
    cursorId: mapped.find((frame) => frame.selected)?.id ?? mapped[0]?.id ?? null,
    undo: [],
    nextFrameNumber: mapped.length + 1
  }
}

export function selectedFrames(state: EditorState): EditorFrame[] {
  return state.frames.filter((frame) => frame.selected)
}

export function setCursor(state: EditorState, frameId: string): EditorState {
  return state.frames.some((frame) => frame.id === frameId)
    ? { ...state, cursorId: frameId }
    : state
}

export function toggleFrame(state: EditorState, frameId: string): EditorState {
  if (!state.frames.some((frame) => frame.id === frameId)) return state
  const next = withUndo(state)
  next.frames = next.frames.map((frame) =>
    frame.id === frameId ? { ...frame, selected: !frame.selected } : frame
  )
  if (next.frames.find((frame) => frame.id === frameId)?.selected) next.cursorId = frameId
  else if (next.cursorId === frameId) next.cursorId = null
  return normalizeCursor(next)
}

export function setAllSelected(state: EditorState, selected: boolean): EditorState {
  if (state.frames.every((frame) => frame.selected === selected)) return state
  const next = withUndo(state)
  next.frames = next.frames.map((frame) => ({ ...frame, selected }))
  if (!selected) next.cursorId = null
  return normalizeCursor(next)
}

export function deselectCurrent(state: EditorState): EditorState {
  return state.cursorId ? toggleFrame(state, state.cursorId) : state
}

export function cloneCurrent(state: EditorState): EditorState {
  const index = state.frames.findIndex((frame) => frame.id === state.cursorId)
  if (index < 0) return state
  const next = withUndo(state)
  const source = next.frames[index]!
  const cloned: EditorFrame = {
    ...source,
    id: `frame-${next.nextFrameNumber}`,
    selected: true,
    clonedFromId: source.id
  }
  next.frames.splice(index + 1, 0, cloned)
  next.cursorId = cloned.id
  next.nextFrameNumber += 1
  return next
}

export function moveFrame(state: EditorState, frameId: string, targetIndex: number): EditorState {
  const from = state.frames.findIndex((frame) => frame.id === frameId)
  if (from < 0 || !Number.isInteger(targetIndex)) return state
  const bounded = Math.max(0, Math.min(targetIndex, state.frames.length - 1))
  if (from === bounded) return state
  const next = withUndo(state)
  const frame = next.frames.splice(from, 1)[0]!
  next.frames.splice(bounded, 0, frame)
  return next
}

export function sampleSelectedEvery(state: EditorState, interval: number): EditorState {
  if (!Number.isInteger(interval) || interval < 1) return state
  const selectedIds = selectedFrames(state).map((frame) => frame.id)
  if (!selectedIds.length || interval === 1) return state
  const keep = new Set(selectedIds.filter((_, index) => index % interval === 0))
  const next = withUndo(state)
  next.frames = next.frames.map((frame) =>
    frame.selected ? { ...frame, selected: keep.has(frame.id) } : frame
  )
  return normalizeCursor(next)
}

export function applyDuplicateFrameIds(state: EditorState, duplicateIds: string[]): EditorState {
  const duplicates = new Set(duplicateIds)
  if (!state.frames.some((frame) => frame.selected && duplicates.has(frame.id))) return state
  const next = withUndo(state)
  next.frames = next.frames.map((frame) =>
    frame.selected && duplicates.has(frame.id) ? { ...frame, selected: false } : frame
  )
  return normalizeCursor(next)
}

export function undoEditor(state: EditorState): EditorState {
  const previous = state.undo.at(-1)
  if (!previous) return state
  return {
    ...state,
    frames: cloneFrames(previous.frames),
    cursorId: previous.cursorId,
    undo: state.undo.slice(0, -1)
  }
}

export function matchingFrameTargets(selectedCount: number, targets: number[]): number[] {
  if (!Number.isInteger(selectedCount) || selectedCount < 1) return []
  return [...new Set(targets)]
    .filter(
      (target) =>
        Number.isInteger(target) && target >= selectedCount && target % selectedCount === 0
    )
    .sort((left, right) => left - right)
}
