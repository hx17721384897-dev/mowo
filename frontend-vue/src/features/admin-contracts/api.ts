import { apiRequest } from '@/services/api-client'

export type ContractType = 'revenue_share' | 'guarantee_plus' | 'buyout' | 'custom'
export type ContractStatus = 'active' | 'expired' | 'terminated'
export interface SettlementLog {
  id: string
  amount: number
  note?: string
  settledAt: string
}
export interface ManagedContract {
  id: string
  creatorName: string
  contractType: ContractType
  status: ContractStatus
  revenueRate: number | null
  guaranteeAmount: number | null
  buyoutAmount: number | null
  startAt: string
  endAt: string | null
  terms: string | null
  note: string | null
  settlementLogs: SettlementLog[]
  totalPaid: number
  createdBy?: string | null
}
export interface ContractPage {
  contracts: ManagedContract[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
}
export interface ContractInput {
  creatorName: string
  contractType: ContractType
  revenueRate?: number
  guaranteeAmount?: number
  buyoutAmount?: number
  startAt: string
  endAt?: string
  terms?: string
  note?: string
}
export function listContracts(
  page: number,
  status: ContractStatus | '',
  contractType: ContractType | '',
  keyword: string
): Promise<ContractPage> {
  const query = new URLSearchParams({ page: String(page), limit: '20' })
  if (status) query.set('status', status)
  if (contractType) query.set('contractType', contractType)
  if (keyword) query.set('keyword', keyword)
  return apiRequest(`/api/admin/contracts?${query}`)
}
export function getContract(id: string): Promise<ManagedContract> {
  return apiRequest(`/api/admin/contracts/${encodeURIComponent(id)}`)
}
export async function saveContract(
  id: string | null,
  input: ContractInput
): Promise<ManagedContract> {
  return apiRequest(
    id ? `/api/admin/contracts/${encodeURIComponent(id)}` : '/api/admin/contracts',
    { method: id ? 'PUT' : 'POST', body: { ...input } }
  )
}
export async function setContractStatus(id: string, status: ContractStatus): Promise<void> {
  await apiRequest(`/api/admin/contracts/${encodeURIComponent(id)}/status`, {
    method: 'PUT',
    body: { status }
  })
}
export async function addContractPayment(
  id: string,
  amount: number,
  note: string,
  settledAt: string,
  clientRequestId: string
): Promise<{ totalPaid: number }> {
  return apiRequest(`/api/admin/contracts/${encodeURIComponent(id)}/settle`, {
    method: 'POST',
    body: { amount, note, settledAt, clientRequestId }
  })
}
