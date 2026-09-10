import { isClosedLegacyProductionEndpoint } from '../src/lib/legacy-production-endpoints.js'

const closed = [
  ['GET', '/api/admin/stats'],
  ['GET', '/api/admin/orders'],
  ['GET', '/api/admin/orders/OLD-1'],
  ['GET', '/api/admin/orders/OLD-1/download-zip'],
  ['PUT', '/api/admin/orders/OLD-1/status'],
  ['PUT', '/api/admin/orders/batch-status'],
  ['PUT', '/api/admin/orders/OLD-1/tracking'],
  ['POST', '/api/admin/orders/export-address'],
  ['POST', '/api/admin/orders/import-tracking'],
  ['POST', '/api/admin/orders/batch-export-frames'],
  ['GET', '/api/admin/production/summary'],
  ['GET', '/api/admin/production/orders'],
  ['GET', '/api/admin/batches/preview'],
  ['POST', '/api/admin/batches'],
  ['GET', '/api/admin/batches/OLD-BATCH/stats'],
  ['POST', '/api/admin/batches/OLD-BATCH/items/OLD-SKU/defect'],
  ['POST', '/api/admin/batches/OLD-BATCH/items/OLD-SKU/complete'],
  ['GET', '/api/admin/scan/sku/OLD'],
  ['GET', '/api/admin/scan/order/OLD'],
  ['GET', '/api/admin/scan/tracking/OLD'],
  ['POST', '/api/admin/scan/confirm-order'],
  ['POST', '/api/admin/scan/ship-tracking'],
  ['GET', '/api/admin/auth-codes/order/OLD'],
  ['GET', '/api/admin/auth-codes/batch/OLD'],
  ['POST', '/api/admin/auth-codes/generate/OLD'],
  ['POST', '/api/customize-orders'],
  ['GET', '/api/customize-orders'],
  ['GET', '/api/customize-orders/OLD'],
  ['POST', '/api/customize-orders/OLD/cancel']
]

for (const [method, path] of closed) {
  if (!isClosedLegacyProductionEndpoint(method, path)) throw new Error(`${method} ${path} should be closed`)
  console.log(`PASS closed ${method} ${path}`)
}

const retained = [
  ['GET', '/api/admin/batches'],
  ['GET', '/api/admin/batches/OLD-BATCH/progress'],
  ['GET', '/api/admin/production-batches'],
  ['POST', '/api/admin/production-batches'],
  ['GET', '/api/admin/production-workflow/orders'],
  ['POST', '/api/admin/production-workflow/pairing'],
  ['GET', '/api/admin/aftersales'],
  ['PUT', '/api/admin/aftersales/REQUEST-ID']
]
for (const [method, path] of retained) {
  if (isClosedLegacyProductionEndpoint(method, path)) throw new Error(`${method} ${path} should remain available`)
  console.log(`PASS retained ${method} ${path}`)
}

console.log(`Legacy production boundary check passed for ${closed.length} closed and ${retained.length} retained examples`)
