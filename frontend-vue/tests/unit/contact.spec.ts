import { describe, expect, it } from 'vitest'
import {
  buildContactPayload,
  contactDefinitions,
  initialContactValues,
  validateContactFiles
} from '@/features/contact/definitions'

describe('contact definitions and payload boundary', () => {
  it('keeps exactly the six approved contact types', () => {
    expect(contactDefinitions.map((item) => item.type)).toEqual([
      'artist',
      'media',
      'feedback',
      'channel',
      'factory',
      'join'
    ])
  })

  it('only accepts approved portfolio and resume file types', () => {
    expect(() =>
      validateContactFiles('artist', [
        new File([new Uint8Array([1])], 'work.png', { type: 'image/png' })
      ])
    ).not.toThrow()
    expect(() =>
      validateContactFiles('artist', [
        new File([new Uint8Array([1])], 'animation.gif', { type: 'image/gif' })
      ])
    ).toThrow('文件类型不符合要求')
    expect(() =>
      validateContactFiles('join', [
        new File([new Uint8Array([1])], 'resume.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        })
      ])
    ).toThrow('文件类型不符合要求')
    expect(() => validateContactFiles('join', [])).toThrow('请上传一份 PDF 简历')
  })

  it('builds anonymous feedback without inventing a user identity', () => {
    const definition = contactDefinitions.find((item) => item.type === 'feedback')!
    const values = initialContactValues(definition)
    values.feedbackType = '我有一个改进建议'
    values.message = '希望按钮的错误提示更清楚。'

    expect(buildContactPayload('feedback', values, [])).toEqual({
      type: 'feedback',
      name: '匿名用户',
      contact: '未留联系方式',
      message: '希望按钮的错误提示更清楚。',
      extra: { feedbackType: '我有一个改进建议' }
    })
  })

  it('rejects non-http external links before submission', () => {
    const definition = contactDefinitions.find((item) => item.type === 'artist')!
    const values = initialContactValues(definition)
    values.name = '测试工作室'
    values.contact = 'test@example.invalid'
    values.message = '这是用于测试的作品介绍。'
    values.portfolioUrl = 'javascript:alert(1)'

    expect(() => buildContactPayload('artist', values, [])).toThrow(
      '作品集链接只允许 HTTP 或 HTTPS'
    )
  })
})
