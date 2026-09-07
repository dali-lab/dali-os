import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  globalSetup: './e2e/global-setup.ts',
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'html' : 'list',
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /reviewer\.spec/,
    },
    {
      name: 'chromium-reviewer',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /reviewer\.spec/,
      dependencies: ['chromium'],
    },
  ],
  webServer: {
    // CI runs e2e against a production build (react-router-serve) rather than
    // the Vite dev server. The dev server compiles routes on demand and
    // re-optimizes deps the first time a heavy route is hit, forcing a full
    // reload that aborts an in-flight navigation (net::ERR_ABORTED) or detaches
    // an element mid-click — the source of the suite's cold-start flakiness. A
    // prebuilt server does neither. Locally we keep the dev server for fast
    // iteration; set CI=1 to exercise the prod path.
    //
    // NODE_ENV=test (not production) is required: it keeps the dev-login route
    // (/dev-login-as, used by every test's loginAs) enabled and preserves the
    // "flags default on outside production" behavior the suite is written
    // against — react-router-serve honors a pre-set NODE_ENV.
    command: process.env.CI ? 'npm run start' : 'npm run dev',
    env: process.env.CI ? { PORT: '3001', NODE_ENV: 'test' } : {},
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
    timeout: process.env.CI ? 120_000 : 60_000,
  },
});
