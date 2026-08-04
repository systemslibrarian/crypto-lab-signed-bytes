import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4669/crypto-lab-signed-bytes/',
    colorScheme: 'dark',
  },
  webServer: {
    // Build before serving: `preview` only serves whatever is already in dist/,
    // so a failed build would leave the last good bundle on disk and the suite
    // would pass green against source that no longer compiles.
    command: 'npm run build && npm run preview -- --port 4669 --strictPort',
    url: 'http://localhost:4669/crypto-lab-signed-bytes/',
    // Port 4669 is this lab's alone — never the Vite default 4173, which the
    // fleet used to share. Never adopt a server we didn't start either:
    // reusing a stale sibling's preview (different base path) turns into a
    // silent 60s timeout, or worse, a green scan of the wrong app. With
    // --strictPort this fails fast and names the busy port instead.
    reuseExistingServer: false,
  },
})
