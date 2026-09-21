// Scratch config: own port, own server, never reuse one that is already running.
import base from './playwright.config';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: 'http://localhost:3099' },
  webServer: {
    command: 'npx react-router dev --port 3099',
    url: 'http://localhost:3099',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
