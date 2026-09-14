const runtime = window.__MOWO_RUNTIME_CONFIG__

function normalizeApiBase(value: string | undefined): string {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) return ''
  return trimmed.replace(/\/+$/, '')
}

function normalizePathBase(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim() || fallback
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return fallback
  return trimmed.replace(/\/+$/, '')
}

export const runtimeConfig = Object.freeze({
  apiBase: normalizeApiBase(runtime?.apiBase),
  legacyWebBase: normalizePathBase(runtime?.legacyWebBase, '/mowo/frontend/pages'),
  environment: runtime?.environment ?? 'development'
})
