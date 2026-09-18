import { apiRequest } from '@/services/api-client'

interface HumanCustomizationPayload {
  machineModelId: string
  sourceKeys: string[]
  clientRequestKey: string
  screeningData: Record<string, unknown>
  userNote: string
}

export interface SubmittedCustomization {
  id: string
  requestNo: string
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('定制申请响应格式不正确')
  }
  return value as Record<string, unknown>
}

export async function submitHumanCustomization(
  payload: HumanCustomizationPayload
): Promise<SubmittedCustomization> {
  const row = record(
    await apiRequest<unknown>('/api/customization-requests', {
      method: 'POST',
      body: { mode: 'HUMAN', ...payload }
    })
  )
  if (typeof row.id !== 'string' || typeof row.requestNo !== 'string') {
    throw new Error('定制申请响应缺少必要字段')
  }
  return { id: row.id, requestNo: row.requestNo }
}
