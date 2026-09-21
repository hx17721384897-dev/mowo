import { runtimeConfig } from './runtime'

export type LegacyPublicPage = 'admin-orders'

const legacyFileByPage: Record<LegacyPublicPage, string> = {
  'admin-orders': 'admin-orders.html'
}

export function legacyPublicUrl(page: LegacyPublicPage): string {
  return `${runtimeConfig.legacyWebBase}/${legacyFileByPage[page]}`
}
