import { beforeEach, describe, expect, it } from 'vitest'
import {
  COLLAB_INTENT_KEY,
  clearCollabIntent,
  readCollabIntent,
  saveCollabIntent
} from '@/features/collab/purchase-intent'

describe('collab pending action', () => {
  beforeEach(clearCollabIntent)

  it('restores a valid recent action', () => {
    saveCollabIntent({
      workId: 'work-1',
      skuId: 'sku-2',
      quantity: 2,
      action: 'prepare-purchase',
      createdAt: 1_000
    })
    expect(readCollabIntent(2_000)).toMatchObject({ workId: 'work-1', skuId: 'sku-2', quantity: 2 })
  })

  it('discards expired or malformed client state', () => {
    localStorage.setItem(COLLAB_INTENT_KEY, '{bad json')
    expect(readCollabIntent()).toBeNull()
    expect(localStorage.getItem(COLLAB_INTENT_KEY)).toBeNull()

    saveCollabIntent({
      workId: 'work-1',
      skuId: 'sku-1',
      quantity: 1,
      action: 'prepare-purchase',
      createdAt: 1_000
    })
    expect(readCollabIntent(1_000 + 16 * 60 * 1_000)).toBeNull()
  })
})
