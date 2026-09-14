interface ClientErrorContext {
  area: string
  action: string
  requestId?: string
  status?: number
}

const SAFE_FIELDS = new Set(['area', 'action', 'requestId', 'status'])

export function reportClientError(context: ClientErrorContext): void {
  const detail = Object.fromEntries(
    Object.entries(context).filter(([key, value]) => SAFE_FIELDS.has(key) && value !== undefined)
  )
  window.dispatchEvent(new CustomEvent('mowo:client-error', { detail }))
  if (import.meta.env.DEV) console.error('[mowo:client-error]', detail)
}
