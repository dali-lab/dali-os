import { test as base } from '@playwright/test';

type LoginOptions = { netId?: string; daliEmail?: string; personalEmail?: string };

// The interactive guide (app/components/LaunchWelcome.tsx) is server-driven: it
// auto-opens for a member with onboardedAt set who either hasn't dismissed it
// or still owes a required setup step. Seeded members have no onboardedAt, so
// it never opens here and there's nothing for the suite to suppress — the
// guide specs stamp the state they need via clearGuideSetup/satisfyGuideSetup.
// If a future seed onboards its members, stamp tourCompletedAt on them (and
// give them a photo, timezone, and calendar link) rather than reaching for
// browser state.

export const test = base.extend<{ loginAs: (opts: LoginOptions) => Promise<void> }>({
  page: async ({ page, baseURL }, use) => {
    await page.addInitScript(() => {
      try {
        // The Drive suite predates the Miller-columns view and exercises
        // list/grid behaviour (bulk-select, drag-and-drop, dblclick nav). Pin
        // List view so those specs run against the UI they were written for;
        // column view (the app default) is covered separately.
        window.localStorage.setItem('dali_drive_view', 'list');
      } catch {
        // localStorage unavailable (e.g. about:blank) — ignore.
      }
    });
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
