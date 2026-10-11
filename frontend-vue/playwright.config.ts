import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  // Keep the full desktop/mobile gate stable on the Windows development host.
  // Eight browser workers can starve the compatibility redirect server and turn
  // simple 404 assertions into infrastructure timeouts.
  workers: 4,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1',
    url: 'http://127.0.0.1:4173/app/',
    reuseExistingServer: process.env.MOWO_REUSE_PREVIEW === '1',
    timeout: 30_000
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } }
  ]
})
