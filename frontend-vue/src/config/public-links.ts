import { runtimeConfig } from './runtime'

export type LegacyPublicPage = 'customize-start' | 'contact'

const legacyFileByPage: Record<LegacyPublicPage, string> = {
  'customize-start': 'customize-start.html',
  contact: 'contact.html'
}

export function legacyPublicUrl(page: LegacyPublicPage): string {
  return `${runtimeConfig.legacyWebBase}/${legacyFileByPage[page]}`
}
