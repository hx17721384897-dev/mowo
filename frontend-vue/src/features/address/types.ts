export interface Address {
  id: string
  label: string | null
  name: string
  phone: string
  province: string
  city: string
  district: string
  detail: string
  isDefault: boolean
}

export interface AddressInput {
  label: string | null
  name: string
  phone: string
  province: string
  city: string
  district: string
  detail: string
}

export interface RegionCity {
  name: string
  districts: string[]
}

export interface RegionProvince {
  name: string
  cities: RegionCity[]
}

export interface RegionData {
  provinces: RegionProvince[]
}

export type AddressParseConfidence = 'high' | 'medium' | 'low'

export interface ParsedAddress extends AddressInput {
  confidence: AddressParseConfidence
}
