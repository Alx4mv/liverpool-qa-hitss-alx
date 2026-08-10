import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the Liverpool.com.mx search automation challenge.
 *
 * - Headless by default (CI-safe).
 * - Headed mode available via: npm run test:headed  (or `playwright test --headed`)
 * - HTML report generated automatically after every run.
 * - Screenshots captured automatically ONLY on failure (framework-level, not manual).
 * - Trace captured on first retry, useful for debugging flaky failures in CI.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,

  reporter: [
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['list'],
  ],

  use: {
    baseURL: process.env.BASE_URL || 'https://www.liverpool.com.mx',
    headless: true, // default; overridden by --headed flag on the CLI
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    locale: 'es-MX',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // If Liverpool's Akamai bot-protection keeps blocking Playwright's
        // bundled Chromium build, switch to the real installed Chrome
        // browser instead — it tends to pass bot-detection fingerprinting
        // more reliably since it's indistinguishable from a normal user's
        // browser. Uncomment the line below (and run `npx playwright install chrome`
        // once) if this happens consistently, not just as a one-off rate limit.
         channel: 'chrome',
      },
    },
    // Bonus: cross-browser parallel execution.
    // Uncomment to run the same suite on Firefox / WebKit.
    // { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
