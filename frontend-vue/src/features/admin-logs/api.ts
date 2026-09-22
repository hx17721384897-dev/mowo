import { apiRequest } from '@/services/api-client'
import type { StaffRole } from '@/services/auth-session'

export interface OperationLog {
  id: string
  userId: string
  userRole: number
  method: string
  path: string
  action: string | null
  outcome: string | null
  statusCode: number | null
  targetId: string | null
  before: string | null
  after: string | null
  ip: string | null
  createdAt: string
  actor: { name: string; maskedPhone: string | null; staffRole: StaffRole | null } | null
}
export interface OperationLogPage {
  logs: OperationLog[]
  pagination: { page: number; limit: number; total: number }
}
export async function listOperationLogs(
  page: number,
  method: string,
  outcome: string
): Promise<OperationLogPage> {
  const query = new URLSearchParams({ page: String(page), limit: '50' })
  if (method) query.set('method', method)
  if (outcome) query.set('outcome', outcome)
  return apiRequest<OperationLogPage>(`/api/admin/logs?${query}`)
}
