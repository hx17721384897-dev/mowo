const CLOSED = [
  ['GET', /^\/api\/admin\/stats$/],
  ['GET', /^\/api\/admin\/orders(?:\/[^/]+)?$/],
  ['GET', /^\/api\/admin\/orders\/[^/]+\/download-zip$/],
  ['PUT', /^\/api\/admin\/orders\/[^/]+\/(?:status|tracking)$/],
  ['PUT', /^\/api\/admin\/orders\/batch-status$/],
  ['POST', /^\/api\/admin\/orders\/(?:export-address|import-tracking|batch-export-frames)$/],
  ['GET', /^\/api\/admin\/production\/(?:summary|orders)$/],
  ['GET', /^\/api\/admin\/batches\/preview$/],
  ['POST', /^\/api\/admin\/batches$/],
  ['GET', /^\/api\/admin\/batches\/[^/]+\/stats$/],
  ['POST', /^\/api\/admin\/batches\/[^/]+\/items\/[^/]+\/(?:defect|complete)$/],
  ['GET', /^\/api\/admin\/scan\/(?:sku|order|tracking)\/[^/]+$/],
  ['POST', /^\/api\/admin\/scan\/(?:confirm-order|ship-tracking)$/],
  ['GET', /^\/api\/admin\/auth-codes\/(?:order|batch)\/[^/]+$/],
  ['POST', /^\/api\/admin\/auth-codes\/generate\/[^/]+$/],
  ['POST', /^\/api\/customize-orders$/],
  ['GET', /^\/api\/customize-orders(?:\/[^/]+)?$/],
  ['POST', /^\/api\/customize-orders\/[^/]+\/cancel$/]
]

export function isClosedLegacyProductionEndpoint(method, rawUrl) {
  const verb = String(method || 'GET').toUpperCase()
  const path = String(rawUrl || '').split('?')[0]
  return CLOSED.some(([expectedMethod, pattern]) => expectedMethod === verb && pattern.test(path))
}
