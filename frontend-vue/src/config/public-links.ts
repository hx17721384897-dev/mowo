import { runtimeConfig } from './runtime'

export type LegacyPublicPage =
  'customize-start' | 'customize-editor' | 'cart' | 'orders' | 'admin-orders'

const legacyFileByPage: Record<LegacyPublicPage, string> = {
  'customize-start': 'customize-start.html',
  'customize-editor': 'customize-editor.html',
  cart: 'cart.html',
  orders: 'orders.html',
  'admin-orders': 'admin-orders.html'
}

export function legacyPublicUrl(page: LegacyPublicPage): string {
  return `${runtimeConfig.legacyWebBase}/${legacyFileByPage[page]}`
}
