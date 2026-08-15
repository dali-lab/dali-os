import { test as base } from '@playwright/test';

type LoginOptions = { netId?: string; daliEmail?: string; personalEmail?: string };

// First-run launch welcome modal (app/components/LaunchWelcome.tsx) renders a
// full-screen dialog overlay that intercepts pointer events on a fresh
// localStorage. Mark it seen before any page script runs so it never blocks
// clicks in tests. Keep this key in sync with DONE_KEY in that component.
const LAUNCH_WELCOME_SEEN_KEY = 'dalios-launch-welcome-seen-v1';

export const test = base.extend<{ loginAs: (opts: LoginOptions) => Promise<void> }>({
  page: async ({ page, baseURL }, use) => {
    await page.addInitScript((key) => {
      try {
        window.localStorage.setItem(key, 'e2e');
        // The Drive suite predates the Miller-columns view and exercises
        // list/grid behaviour (bulk-select, drag-and-drop, dblclick nav). Pin
        // List view so those specs run against the UI they were written for;
        // column view (the app default) is covered separately.
        window.localStorage.setItem('dali_drive_view', 'list');
      } catch {
        // localStorage unavailable (e.g. about:blank) — ignore.
      }
    }, LAUNCH_WELCOME_SEEN_KEY);
    // The suite was written against the tabbed workspace shell (several specs
    // locate content via frameLocator on workspace iframes). Tabless is the
    // app default now, so pin the tabbed opt-in cookie per context. Keep the
    // name/value in sync with TABLESS_COOKIE in app/lib/tabless.ts.
    if (baseURL) {
      await page.context().addCookies([{ name: 'dali_tabless', value: '0', url: baseURL }]);
    }
    await use(page);
  },
  loginAs: async ({ page }, use) => {
    await use(async ({ netId, daliEmail, personalEmail }: LoginOptions) => {
      const params = new URLSearchParams();
      if (daliEmail) params.set('daliEmail', daliEmail);
      else if (personalEmail) params.set('personalEmail', personalEmail);
      else if (netId) params.set('netId', netId);
      await page.goto(`/dev-login-as?${params}`);
      await page.waitForLoadState('networkidle');
    });
  },
});

export { expect } from '@playwright/test';
