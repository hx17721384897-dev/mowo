const within = prefix => path => path === prefix || path.startsWith(`${prefix}/`)

const RETIRED_ENDPOINTS = [
  within('/api/articles'),
  within('/api/feed'),
  path => /^\/api\/users\/[^/]+\/(articles|follow|follow-status)(\/|$)/.test(path),
  path => /^\/api\/collab\/works\/[^/]+\/like(\/|$)/.test(path),
  within('/api/products'),
  within('/api/animations'),
  within('/api/collab/apply'),
  within('/api/collab/my-works'),
  within('/api/earnings'),
  within('/api/creator/settlement'),
  within('/api/admin/settlement'),
  within('/api/admin/revenue'),
  within('/api/creator/bull'),
  within('/api/admin/bull'),
  within('/api/creator/links'),
  within('/api/admin/links'),
  within('/api/admin/collab/activities'),
  within('/api/certify')
]

export function isRetiredEndpoint(url) {
  const path = String(url || '').split('?')[0]
  return RETIRED_ENDPOINTS.some(matches => matches(path))
}
