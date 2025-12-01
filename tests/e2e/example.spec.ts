import { test, expect } from '@playwright/test';

test('Playwright is set up and runs a basic test', async ({ page }) => {
  await page.goto('https://playwright.dev/');
  await expect(page).toHaveTitle(/Playwright/);
});