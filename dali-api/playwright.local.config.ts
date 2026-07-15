// Temporary local-only config: the main worktree's dev server occupies 3001,
// so run this worktree's e2e against its own server on 3033. Not for CI.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  globalSetup: './e2e/global-setup.ts',
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3033',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /reviewer\.spec/,
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 3033',
    url: 'http://localhost:3033',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
