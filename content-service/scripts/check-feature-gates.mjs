import { requiredFeatureForRequest } from '../src/lib/features.js'
import { isRetiredEndpoint } from '../src/lib/retired-endpoints.js'

const retiredPaths = [
  '/api/articles',
  '/api/articles/article-id/comments',
  '/api/feed',
  '/api/users/user-id/articles',
  '/api/users/user-id/follow',
  '/api/users/user-id/follow-status',
  '/api/collab/works/work-id/like',
  '/api/products',
  '/api/products/product-id',
  '/api/animations',
  '/api/animations/animation-id',
  '/api/collab/apply',
  '/api/collab/my-works',
  '/api/earnings',
  '/api/creator/settlement',
  '/api/admin/settlement',
  '/api/admin/revenue',
  '/api/creator/bull',
  '/api/admin/bull',
  '/api/creator/links',
  '/api/admin/links',
  '/api/admin/collab/activities',
  '/api/certify/status'
]

for (const path of retiredPaths) {
  if (!isRetiredEndpoint(path)) throw new Error(`${path}: missing permanent retirement boundary`)
  if (requiredFeatureForRequest(path) !== null) throw new Error(`${path}: retired endpoint must not retain a feature flag`)
  console.log(`PASS retired ${path}`)
}

const retirementNearMisses = [
  '/api/articleship',
  '/api/feed-back',
  '/api/products-v2',
  '/api/animations-preview',
  '/api/collab/application',
  '/api/creator/settlements',
  '/api/admin/revenues',
  '/api/certify-provider'
]

for (const path of retirementNearMisses) {
  if (isRetiredEndpoint(path)) throw new Error(`${path}: retirement prefix is too broad`)
}

const activeGates = [
  ['/api/cart/checkout', 'onlineCheckout'],
  ['/api/payment/callback', 'onlineCheckout'],
  ['/api/payment/status/preorder-id', 'onlineCheckout'],
  ['/api/payment/mock-pay/preorder-id', 'onlineCheckout']
]

for (const [path, expected] of activeGates) {
  const actual = requiredFeatureForRequest(path)
  if (actual !== expected) throw new Error(`${path}: expected ${expected}, received ${actual}`)
  if (isRetiredEndpoint(path)) throw new Error(`${path}: active feature was marked retired`)
  console.log(`PASS gated ${path} -> ${actual}`)
}

const openPaths = ['/api/users/user-id', '/api/collab/works', '/api/cart', '/api/admin/contracts']
for (const path of openPaths) {
  if (requiredFeatureForRequest(path) !== null) throw new Error(`${path}: unexpectedly feature-gated`)
  if (isRetiredEndpoint(path)) throw new Error(`${path}: unexpectedly retired`)
  console.log(`PASS open ${path}`)
}

console.log(`Retirement and active feature mapping passed for ${retiredPaths.length} retired paths and ${retirementNearMisses.length} near-miss paths`)
