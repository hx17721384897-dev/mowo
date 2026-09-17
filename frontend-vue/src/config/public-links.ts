import { runtimeConfig } from './runtime'

export type LegacyPublicPage =
  'customize-start' | 'cart' | 'orders' | 'my-customizations' | 'my-animations' | 'admin-orders'

const legacyFileByPage: Record<LegacyPublicPage, string> = {
  'customize-start': 'customize-start.html',
  cart: 'cart.html',
  orders: 'orders.html',
  'my-customizations': 'my-customizations.html',
  'my-animations': 'my-animations.html',
  'admin-orders': 'admin-orders.html'
}

export function legacyPublicUrl(page: LegacyPublicPage): string {
  return `${runtimeConfig.legacyWebBase}/${legacyFileByPage[page]}`
}
