import { runtimeConfig } from './runtime'

export type LegacyPublicPage = 'showcase' | 'customize-start' | 'contact'

const legacyFileByPage: Record<LegacyPublicPage, string> = {
  showcase: 'showcase.html',
  'customize-start': 'customize-start.html',
  contact: 'contact.html'
}

export function legacyPublicUrl(page: LegacyPublicPage): string {
  return `${runtimeConfig.legacyWebBase}/${legacyFileByPage[page]}`
}
