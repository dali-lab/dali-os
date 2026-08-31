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
    // Compile the heaviest route trees once before the parallel workers run so
    // they don't race the Vite dev server's on-demand compiler on the 2-vCPU CI
    // runner (see e2e/warmup.setup.ts). This is a hard dependency of the test
    // projects: everything below runs against a warm server.
    {
      name: 'setup',
      testMatch: /warmup\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: [/reviewer\.spec/, /warmup\.setup/],
      dependencies: ['setup'],
    },
    {
      name: 'chromium-reviewer',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /reviewer\.spec/,
      dependencies: ['chromium'],
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3001',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
