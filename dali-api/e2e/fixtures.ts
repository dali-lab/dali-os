import { test as base } from '@playwright/test';

type LoginOptions = { netId?: string; daliEmail?: string };

// First-run launch welcome modal (app/components/LaunchWelcome.tsx) renders a
// full-screen dialog overlay that intercepts pointer events on a fresh
// localStorage. Mark it seen before any page script runs so it never blocks
// clicks in tests. Keep this key in sync with DONE_KEY in that component.
const LAUNCH_WELCOME_SEEN_KEY = 'dalios-launch-welcome-seen-v1';

export const test = base.extend<{ loginAs: (opts: LoginOptions) => Promise<void> }>({
  page: async ({ page }, use) => {
    await page.addInitScript((key) => {
      try {
        window.localStorage.setItem(key, 'e2e');
      } catch {
        // localStorage unavailable (e.g. about:blank) — ignore.
      }
    }, LAUNCH_WELCOME_SEEN_KEY);
    await use(page);
  },
  loginAs: async ({ page }, use) => {
    await use(async ({ netId, daliEmail }: LoginOptions) => {
      const params = new URLSearchParams();
      if (daliEmail) params.set('daliEmail', daliEmail);
      else if (netId) params.set('netId', netId);
      await page.goto(`/dev-login-as?${params}`);
      await page.waitForLoadState('networkidle');
    });
  },
});

export { expect } from '@playwright/test';
