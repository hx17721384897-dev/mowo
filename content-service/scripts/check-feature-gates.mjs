import { publicFeatureFlags, requiredFeatureForRequest } from '../src/lib/features.js'
import { loadConfig } from '../src/config/env.js'

const activeGates = [
  ['/api/cart/checkout', 'onlineCheckout'],
  ['/api/payment/callback', 'onlineCheckout'],
  ['/api/payment/status/preorder-id', 'onlineCheckout'],
  ['/api/payment/mock-pay/preorder-id', 'onlineCheckout'],
  ['/api/admin/import/taobao', 'externalOrderImport'],
  ['/api/admin/import/manual', 'externalOrderImport'],
  ['/api/admin/import/pending', 'externalOrderImport'],
  ['/api/admin/sku-mapping', 'externalOrderImport']
]

for (const [path, expected] of activeGates) {
  const actual = requiredFeatureForRequest(path)
  if (actual !== expected) throw new Error(`${path}: expected ${expected}, received ${actual}`)
  console.log(`PASS gated ${path} -> ${actual}`)
}

const openPaths = [
  '/api/collab/works',
  '/api/cart'
]
for (const path of openPaths) {
  if (requiredFeatureForRequest(path) !== null) throw new Error(`${path}: unexpectedly feature-gated`)
  console.log(`PASS open or staff-protected ${path}`)
}

const flags = publicFeatureFlags({
  features: {
    onlineCheckout: false,
    mockPayment: false,
    passwordLogin: false,
    externalOrderImport: false
  }
})
if (flags.mockPayment !== false) throw new Error('mockPayment: expected a closed public test flag')
for (const retired of ['community', 'creatorFinance', 'bullSystem', 'mockCertification']) {
  if (retired in flags) throw new Error(`${retired}: retired feature leaked into public configuration`)
}

const baseEnv = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/mowo_b1_test',
  JWT_SECRET: 'test-jwt-secret',
  COOKIE_SECRET: 'test-cookie-secret',
  SMS_MOCK: 'true',
  ONLINE_CHECKOUT_ENABLED: 'true',
  MOCK_PAYMENT_ENABLED: 'true',
  EXTERNAL_ORDER_IMPORT_ENABLED: 'false'
}
const mockConfig = loadConfig(baseEnv)
if (!mockConfig.features.mockPayment) throw new Error('isolated test database should allow explicit mock payment mode')

for (const [name, override] of [
  ['closed checkout', { ONLINE_CHECKOUT_ENABLED: 'false' }],
  ['non-test database', { DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/mowo_db' }],
  ['production', { NODE_ENV: 'production' }]
]) {
  try {
    loadConfig({ ...baseEnv, ...override })
    throw new Error(`${name}: unsafe mock payment configuration was accepted`)
  } catch (error) {
    if (String(error?.message).includes('unsafe mock payment configuration was accepted')) throw error
  }
  console.log(`PASS mock payment rejects ${name}`)
}

try {
  loadConfig({ ...baseEnv, NODE_ENV: 'production', MOCK_PAYMENT_ENABLED: 'false' })
  throw new Error('production online checkout without verified callbacks was accepted')
} catch (error) {
  if (String(error?.message).includes('was accepted')) throw error
  if (!String(error?.message).includes('ONLINE_CHECKOUT_ENABLED must be false in production')) {
    throw new Error('production checkout rejection did not report the payment verification boundary')
  }
}
console.log('PASS production cannot enable online checkout before verified payment callbacks exist')

try {
  loadConfig({ ...baseEnv, EXTERNAL_ORDER_IMPORT_ENABLED: 'true' })
  throw new Error('external order import was enabled before its contract was approved')
} catch (error) {
  if (String(error?.message).includes('was enabled')) throw error
  if (!String(error?.message).includes('EXTERNAL_ORDER_IMPORT_ENABLED must remain false')) {
    throw new Error('external import rejection did not report the missing contract boundary')
  }
}
console.log('PASS external order import cannot be enabled before its contract is approved')

console.log(`Active feature mapping passed for ${activeGates.length} gated paths and ${openPaths.length} retained paths`)
