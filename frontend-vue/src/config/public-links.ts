import { runtimeConfig } from './runtime'

export type LegacyPublicPage =
  'customize-editor' | 'customize-confirm' | 'cart' | 'orders' | 'admin-orders'

const legacyFileByPage: Record<LegacyPublicPage, string> = {
  'customize-editor': 'customize-editor.html',
  'customize-confirm': 'customize-confirm.html',
  cart: 'cart.html',
  orders: 'orders.html',
  'admin-orders': 'admin-orders.html'
}

export function legacyPublicUrl(page: LegacyPublicPage): string {
  return `${runtimeConfig.legacyWebBase}/${legacyFileByPage[page]}`
}
