import type { AddressInput, ParsedAddress, RegionData } from './types'

const EMPTY_ADDRESS: AddressInput = {
  name: '',
  phone: '',
  province: '',
  city: '',
  district: '',
  detail: '',
  label: null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function emptyAddress(): AddressInput {
  return { ...EMPTY_ADDRESS }
}

export function smartParseAddress(text: string, regions: RegionData): ParsedAddress {
  if (!text.trim()) return { ...EMPTY_ADDRESS, confidence: 'low' }

  let remaining = text.trim()
  const phoneMatch = remaining.match(/1[3-9]\d{9}/)
  const phone = phoneMatch?.[0] ?? ''
  if (phone) remaining = remaining.replace(phone, ' ')

  let name = ''
  const namePatterns = [
    /^[\s,，、-]*([^\d\s,，、-]{2,5})[\s,，、-]+/,
    new RegExp(`([^\\d\\s,，、]{2,5})[\\s,，、]*${phone || '1[3-9]\\d{9}'}`)
  ]
  for (const pattern of namePatterns) {
    const match = text.match(pattern)
    if (match?.[1] && /[\u4e00-\u9fa5]/.test(match[1])) {
      name = match[1].trim()
      break
    }
  }
  if (name) remaining = remaining.replace(name, ' ')

  let province = ''
  let city = ''
  let district = ''
  for (const provinceEntry of regions.provinces) {
    const provinceShort = provinceEntry.name.replace(/省$|市$|自治区$|特别行政区$/, '')
    if (
      !new RegExp(`${escapeRegExp(provinceEntry.name)}|${escapeRegExp(provinceShort)}`).test(
        remaining
      )
    ) {
      continue
    }
    province = provinceEntry.name
    for (const cityEntry of provinceEntry.cities) {
      const cityShort = cityEntry.name.replace(/市$|地区$|自治州$|盟$/, '')
      if (
        !new RegExp(`${escapeRegExp(cityEntry.name)}|${escapeRegExp(cityShort)}`).test(remaining)
      ) {
        continue
      }
      city = cityEntry.name
      for (const districtEntry of cityEntry.districts) {
        const districtShort = districtEntry.replace(/区$|县$|市$/, '')
        if (
          new RegExp(
            `${escapeRegExp(districtEntry)}|${escapeRegExp(districtShort)}(?=区|县|市)`
          ).test(remaining)
        ) {
          district = districtEntry
          break
        }
      }
      break
    }
    if (!city && provinceEntry.cities.length === 1) {
      const directCity = provinceEntry.cities[0]
      if (directCity) {
        city = directCity.name
        district = directCity.districts.find((item) => remaining.includes(item)) ?? ''
      }
    }
    break
  }

  let detail = remaining
  for (const regionName of [province, city, district]) {
    if (regionName) detail = detail.replace(new RegExp(escapeRegExp(regionName)), ' ')
  }
  detail = detail.replace(/[\s,，、-]+/g, ' ').trim()
  if (name) detail = detail.replace(new RegExp(escapeRegExp(name)), '').trim()
  detail = detail
    .replace(/^\s*[\s,，、-]+/, '')
    .replace(/[\s,，、-]+\s*$/, '')
    .trim()

  const fieldsFound = [name, phone, province, city, district, detail].filter(Boolean).length
  return {
    name,
    phone,
    province,
    city,
    district,
    detail,
    label: null,
    confidence: fieldsFound >= 5 ? 'high' : fieldsFound >= 3 ? 'medium' : 'low'
  }
}

export function validateAddress(input: AddressInput): string | null {
  if (!input.name.trim()) return '请填写收件人姓名'
  if (!/^1[3-9]\d{9}$/.test(input.phone.trim())) return '请填写正确的手机号'
  if (!input.province) return '请选择省份'
  if (!input.city) return '请选择城市'
  if (!input.district) return '请选择区/县'
  if (input.detail.trim().length < 5) return '详细地址不少于5个字符'
  return null
}

export function maskAddressPhone(phone: string): string {
  return phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2')
}
