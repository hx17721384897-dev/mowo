const GATES = [
  {
    feature: 'onlineCheckout',
    match: path => path === '/api/cart/checkout' || path.startsWith('/api/payment/')
  }
]

export function requiredFeatureForRequest(url) {
  const path = String(url || '').split('?')[0]
  return GATES.find(gate => gate.match(path))?.feature || null
}

export function publicFeatureFlags(config) {
  return {
    onlineCheckout: config.features.onlineCheckout,
    mockPayment: config.features.mockPayment,
    passwordLogin: config.features.passwordLogin
  }
}
