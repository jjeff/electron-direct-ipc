import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: process.env.CI ? 120_000 : 30_000, // 2 min timeout for CI (Windows is slow)
  expect: {
    timeout: 15_000, // Longer expect timeout for slower CI environments
  },
  fullyParallel: false, // Electron apps should run serially
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Electron tests need to run one at a time
  reporter: process.env.CI
    ? [
        ['github'],
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
        ['list'], // Also show list output for easier debugging
      ]
    : [['list'], ['html', { open: 'on-failure' }]],
  use: {
    actionTimeout: 0,
    trace: process.env.CI ? 'on' : 'on-first-retry', // Always capture trace in CI
    screenshot: process.env.CI ? 'on' : 'only-on-failure', // Always capture screenshots in CI
    video: 'retain-on-failure',
  },
});