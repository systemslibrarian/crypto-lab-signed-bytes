import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173/crypto-lab-signed-bytes/',
    colorScheme: 'dark',
  },
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173/crypto-lab-signed-bytes/',
    // Never adopt a server we didn't start: the whole crypto-lab fleet
    // previews on 4173, and reusing a stale sibling's preview (different
    // base path) turns into a silent 60s timeout. With --strictPort this
    // fails fast and names the busy port instead.
    reuseExistingServer: false,
  },
})
