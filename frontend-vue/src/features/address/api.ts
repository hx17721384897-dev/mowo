import { apiRequest } from '@/services/api-client'
import type { Address, AddressInput } from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeAddress(value: unknown): Address | null {
  if (!isRecord(value)) return null
  const requiredStrings = ['id', 'name', 'phone', 'province', 'city', 'district', 'detail'] as const
  if (requiredStrings.some((key) => typeof value[key] !== 'string')) return null
  return {
    id: value.id as string,
    label: typeof value.label === 'string' ? value.label : null,
    name: value.name as string,
    phone: value.phone as string,
    province: value.province as string,
    city: value.city as string,
    district: value.district as string,
    detail: value.detail as string,
    isDefault: value.isDefault === true
  }
}

function requireAddress(value: unknown): Address {
  const address = normalizeAddress(value)
  if (!address) throw new Error('地址响应格式不正确')
  return address
}

export async function listAddresses(): Promise<Address[]> {
  const data = await apiRequest<unknown>('/api/addresses')
  if (!Array.isArray(data)) throw new Error('地址列表响应格式不正确')
  const addresses = data.map(normalizeAddress)
  if (addresses.some((address) => address === null)) throw new Error('地址列表响应格式不正确')
  return addresses as Address[]
}

export async function createAddress(input: AddressInput): Promise<Address> {
  return requireAddress(
    await apiRequest('/api/addresses', {
      method: 'POST',
      body: { ...input }
    })
  )
}

export async function updateAddress(id: string, input: AddressInput): Promise<Address> {
  return requireAddress(
    await apiRequest(`/api/addresses/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: { ...input }
    })
  )
}

export async function deleteAddress(id: string): Promise<void> {
  await apiRequest(`/api/addresses/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function setDefaultAddress(id: string): Promise<void> {
  await apiRequest(`/api/addresses/${encodeURIComponent(id)}/default`, { method: 'PUT' })
}
