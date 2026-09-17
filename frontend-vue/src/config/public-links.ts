import { runtimeConfig } from './runtime'

export type LegacyPublicPage = 'customize-start' | 'cart' | 'orders' | 'settings'

const legacyFileByPage: Record<LegacyPublicPage, string> = {
  'customize-start': 'customize-start.html',
  cart: 'cart.html',
  orders: 'orders.html',
  settings: 'settings.html'
}

export function legacyPublicUrl(page: LegacyPublicPage): string {
  return `${runtimeConfig.legacyWebBase}/${legacyFileByPage[page]}`
}
