/// <reference types="vite/client" />

interface MowoRuntimeConfig {
  apiBase: string
  legacyWebBase: string
  environment: 'development' | 'test' | 'staging' | 'production'
}

interface Window {
  __MOWO_RUNTIME_CONFIG__?: Readonly<MowoRuntimeConfig>
}
