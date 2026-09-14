import { publicFeatureFlags, requiredFeatureForRequest } from '../src/lib/features.js'

const activeGates = [
  ['/api/cart/checkout', 'onlineCheckout'],
  ['/api/payment/callback', 'onlineCheckout'],
  ['/api/payment/status/preorder-id', 'onlineCheckout'],
  ['/api/payment/mock-pay/preorder-id', 'onlineCheckout']
]

for (const [path, expected] of activeGates) {
  const actual = requiredFeatureForRequest(path)
  if (actual !== expected) throw new Error(`${path}: expected ${expected}, received ${actual}`)
  console.log(`PASS gated ${path} -> ${actual}`)
}

const openPaths = [
  '/api/collab/works',
  '/api/cart',
  '/api/admin/contracts',
  '/api/admin/import/pending',
  '/api/admin/sku-mapping'
]
for (const path of openPaths) {
  if (requiredFeatureForRequest(path) !== null) throw new Error(`${path}: unexpectedly feature-gated`)
  console.log(`PASS open or staff-protected ${path}`)
}

const flags = publicFeatureFlags({ features: { onlineCheckout: false, passwordLogin: false } })
for (const retired of ['community', 'creatorFinance', 'bullSystem', 'mockCertification']) {
  if (retired in flags) throw new Error(`${retired}: retired feature leaked into public configuration`)
}

console.log(`Active feature mapping passed for ${activeGates.length} gated paths and ${openPaths.length} retained paths`)
