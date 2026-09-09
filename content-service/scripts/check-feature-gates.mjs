import { requiredFeatureForRequest } from '../src/lib/features.js'

const registeredClosedEndpoints = [
  ['POST', '/api/articles'],
  ['GET', '/api/articles'],
  ['GET', '/api/articles/article-id'],
  ['PUT', '/api/articles/article-id'],
  ['DELETE', '/api/articles/article-id'],
  ['POST', '/api/articles/article-id/like'],
  ['POST', '/api/articles/article-id/collect'],
  ['POST', '/api/articles/article-id/comments'],
  ['GET', '/api/articles/article-id/comments'],
  ['GET', '/api/feed'],
  ['GET', '/api/users/user-id/articles'],
  ['POST', '/api/users/user-id/follow'],
  ['GET', '/api/users/user-id/follow-status'],
  ['POST', '/api/cart/checkout'],
  ['POST', '/api/payment/callback'],
  ['GET', '/api/payment/status/preorder-id'],
  ['POST', '/api/payment/mock-pay/preorder-id']
]

const reservedClosedPrefixes = [
  ['community', '/api/collab/works/work-id/like'],
  ['creatorFinance', '/api/earnings'],
  ['creatorFinance', '/api/creator/settlement'],
  ['creatorFinance', '/api/admin/settlement'],
  ['creatorFinance', '/api/admin/revenue'],
  ['bullSystem', '/api/creator/bull'],
  ['bullSystem', '/api/admin/bull'],
  ['bullSystem', '/api/creator/links'],
  ['bullSystem', '/api/admin/links'],
  ['mockCertification', '/api/certify/status']
]

const expectedFeature = path => {
  if (path.startsWith('/api/articles') || path.startsWith('/api/feed') || /\/api\/users\/[^/]+\/(articles|follow|follow-status)/.test(path)) return 'community'
  if (path.startsWith('/api/cart/checkout') || path.startsWith('/api/payment/')) return 'onlineCheckout'
  return null
}

for (const [method, path] of registeredClosedEndpoints) {
  const expected = expectedFeature(path)
  const actual = requiredFeatureForRequest(path)
  if (actual !== expected) throw new Error(`${method} ${path}: expected ${expected}, received ${actual}`)
  console.log(`PASS ${method} ${path} -> ${actual}`)
}

for (const [expected, path] of reservedClosedPrefixes) {
  const actual = requiredFeatureForRequest(path)
  if (actual !== expected) throw new Error(`${path}: expected ${expected}, received ${actual}`)
  console.log(`PASS reserved ${path} -> ${actual}`)
}

const openPaths = ['/api/users/user-id', '/api/collab/works', '/api/cart', '/api/admin/contracts']
for (const path of openPaths) {
  const actual = requiredFeatureForRequest(path)
  if (actual !== null) throw new Error(`${path}: unexpectedly gated by ${actual}`)
  console.log(`PASS open boundary ${path}`)
}

console.log(`Feature gate mapping check passed for ${registeredClosedEndpoints.length} registered endpoints and ${reservedClosedPrefixes.length} reserved prefixes`)
