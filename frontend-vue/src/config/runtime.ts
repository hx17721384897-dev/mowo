const runtime = window.__MOWO_RUNTIME_CONFIG__

function normalizeApiBase(value: string | undefined): string {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) return ''
  return trimmed.replace(/\/+$/, '')
}

export const runtimeConfig = Object.freeze({
  apiBase: normalizeApiBase(runtime?.apiBase),
  environment: runtime?.environment ?? 'development'
})
