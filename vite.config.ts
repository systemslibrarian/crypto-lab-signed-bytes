import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: '/crypto-lab-signed-bytes/',
  server: {
    port: 5173,
    host: true,
  },
  test: {
    // Keep Playwright e2e specs out of the Vitest run.
    include: ['src/**/*.test.ts'],
  },
})
