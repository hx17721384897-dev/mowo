import { describe, expect, it } from 'vitest'
import {
  applyDuplicateFrameIds,
  capabilitiesForMode,
  cloneCurrent,
  createEditorState,
  deselectCurrent,
  EditorEntryError,
  matchingFrameTargets,
  moveFrame,
  resolveEditorEntry,
  sampleSelectedEvery,
  selectedFrames,
  setAllSelected,
  setCursor,
  toggleFrame,
  undoEditor
} from '@/features/customize-editor/editor-core'

function stateOf(count = 4) {
  return createEditorState(
    Array.from({ length: count }, (_, index) => ({ source: `data:image/png;base64,${index}` }))
  )
}

describe('customize editor entry modes', () => {
  it('resolves every supported entry without trusting a generic mode flag', () => {
    expect(resolveEditorEntry(new URLSearchParams('modelId=model-1'))).toEqual({
      mode: 'new-customization',
      resourceId: null,
      modelId: 'model-1'
    })
    expect(resolveEditorEntry(new URLSearchParams('productId=draft-1'))).toMatchObject({
      mode: 'draft-edit',
      resourceId: 'draft-1'
    })
    expect(resolveEditorEntry(new URLSearchParams('assetId=asset-1'))).toMatchObject({
      mode: 'asset-version',
      resourceId: 'asset-1'
    })
    expect(resolveEditorEntry(new URLSearchParams('reviewRequestId=request-1'))).toMatchObject({
      mode: 'customer-review'
    })
    expect(resolveEditorEntry(new URLSearchParams('adminRequestId=request-2'))).toMatchObject({
      mode: 'staff-review'
    })
    expect(resolveEditorEntry(new URLSearchParams('frameDraftId=frame-1'))).toMatchObject({
      mode: 'frame-library'
    })
  })

  it('rejects conflicting resource modes instead of choosing by script order', () => {
    expect(() =>
      resolveEditorEntry(new URLSearchParams('assetId=asset-1&adminRequestId=request-1'))
    ).toThrow(EditorEntryError)
  })

  it('keeps customer review read-only and restricts library publishing to owners', () => {
    expect(capabilitiesForMode('customer-review')).toMatchObject({
      canMutateFrames: false,
      canChangeSelection: false,
      canSubmitRevision: true,
      canSaveVersion: false
    })
    expect(capabilitiesForMode('frame-library', 'PRODUCTION').canPublishLibraryAsset).toBe(false)
    expect(capabilitiesForMode('frame-library', 'OWNER').canPublishLibraryAsset).toBe(true)
  })
})

describe('customize editor frame state', () => {
  it('selects, clones, moves and restores one coherent snapshot', () => {
    let state = stateOf(3)
    state = setCursor(state, 'frame-2')
    state = cloneCurrent(state)
    expect(state.frames.map((frame) => frame.id)).toEqual([
      'frame-1',
      'frame-2',
      'frame-4',
      'frame-3'
    ])
    expect(state.cursorId).toBe('frame-4')
    expect(state.frames[2]?.clonedFromId).toBe('frame-2')

    state = moveFrame(state, 'frame-4', 0)
    expect(state.frames[0]?.id).toBe('frame-4')
    state = undoEditor(state)
    expect(state.frames.map((frame) => frame.id)).toEqual([
      'frame-1',
      'frame-2',
      'frame-4',
      'frame-3'
    ])
    state = undoEditor(state)
    expect(state.frames.map((frame) => frame.id)).toEqual(['frame-1', 'frame-2', 'frame-3'])
  })

  it('applies sampling and duplicate results only to currently selected frames', () => {
    let state = toggleFrame(stateOf(6), 'frame-2')
    state = sampleSelectedEvery(state, 2)
    expect(selectedFrames(state).map((frame) => frame.id)).toEqual([
      'frame-1',
      'frame-4',
      'frame-6'
    ])
    state = applyDuplicateFrameIds(state, ['frame-4', 'frame-5'])
    expect(selectedFrames(state).map((frame) => frame.id)).toEqual(['frame-1', 'frame-6'])
  })

  it('normalizes the cursor and supports reversible bulk selection', () => {
    let state = setCursor(stateOf(2), 'frame-1')
    state = deselectCurrent(state)
    expect(state.cursorId).toBe('frame-2')
    state = setAllSelected(state, false)
    expect(state.cursorId).toBeNull()
    state = undoEditor(state)
    expect(state.cursorId).toBe('frame-2')
    expect(selectedFrames(state)).toHaveLength(1)
  })

  it('matches only positive divisible target frame counts', () => {
    expect(matchingFrameTargets(6, [24, 12, 8, 12, -6, 6.5])).toEqual([12, 24])
    expect(matchingFrameTargets(0, [12, 24])).toEqual([])
  })
})
