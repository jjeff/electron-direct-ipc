import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: process.env.CI ? 60_000 : 30_000, // Longer timeout for CI (especially Windows)
  expect: {
    timeout: 10_000, // Longer expect timeout for slower CI environments
  },
  fullyParallel: false, // Electron apps should run serially
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Electron tests need to run one at a time
  reporter: process.env.CI ? [['github'], ['html', { outputFolder: 'playwright-report', open: 'never' }]] : [['list'], ['html', { open: 'on-failure' }]],
  use: {
    actionTimeout: 0,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});