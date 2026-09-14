import { describe, expect, it } from 'vitest'
import { agreementSections, faqItems, privacySections } from '@/content/public-content'

describe('public V1a content boundary', () => {
  it('contains no retired or unapproved launch promises', () => {
    const currentCopy = JSON.stringify({ faqItems, agreementSections, privacySections })
    expect(currentCopy).not.toContain('7 天无理由')
    expect(currentCopy).not.toContain('全球配送')
    expect(currentCopy).not.toContain('牛量积分')
    expect(currentCopy).not.toContain('可提现余额')
  })

  it('keeps both legal drafts complete and clearly versioned', () => {
    expect(agreementSections).toHaveLength(10)
    expect(privacySections).toHaveLength(10)
  })
})
