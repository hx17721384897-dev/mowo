import { runtimeConfig } from './runtime'

export type LegacyPublicPage = 'customize-start' | 'contact' | 'cart' | 'orders' | 'settings'

const legacyFileByPage: Record<LegacyPublicPage, string> = {
  'customize-start': 'customize-start.html',
  contact: 'contact.html',
  cart: 'cart.html',
  orders: 'orders.html',
  settings: 'settings.html'
}

export function legacyPublicUrl(page: LegacyPublicPage): string {
  return `${runtimeConfig.legacyWebBase}/${legacyFileByPage[page]}`
}
