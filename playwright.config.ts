import { defineConfig } from '@playwright/test'

/**
 * End-to-end tests drive the real Electron app (built into out/ by `npm run build`).
 * Each test file starts its own copy with a throwaway data folder (CLUTCH_USER_DATA), so it never
 * touches the installed Clutch, your clips, your settings or the Windows startup entry.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test-results/report' }]],
  outputDir: 'test-results/artifacts',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' }
})
