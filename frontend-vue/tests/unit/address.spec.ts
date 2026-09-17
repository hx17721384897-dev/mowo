import { describe, expect, it } from 'vitest'
import {
  maskAddressPhone,
  smartParseAddress,
  validateAddress
} from '@/features/address/address-utils'
import type { RegionData } from '@/features/address/types'

const regions: RegionData = {
  provinces: [
    {
      name: '广东省',
      cities: [{ name: '深圳市', districts: ['南山区', '福田区'] }]
    }
  ]
}

describe('address domain', () => {
  it('keeps the legacy smart parse behavior for a complete address', () => {
    expect(smartParseAddress('张三 13800138000 广东省深圳市南山区科技园南路88号', regions)).toEqual(
      {
        name: '张三',
        phone: '13800138000',
        province: '广东省',
        city: '深圳市',
        district: '南山区',
        detail: '科技园南路88号',
        label: null,
        confidence: 'high'
      }
    )
  })

  it('uses the same validation order as the legacy forms', () => {
    expect(
      validateAddress({
        name: '张三',
        phone: '13800138000',
        province: '广东省',
        city: '深圳市',
        district: '南山区',
        detail: '科技园',
        label: null
      })
    ).toBe('详细地址不少于5个字符')
  })

  it('masks valid mainland phone numbers', () => {
    expect(maskAddressPhone('13800138000')).toBe('138****8000')
  })
})
