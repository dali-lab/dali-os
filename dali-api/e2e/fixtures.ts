import { test as base } from '@playwright/test';

type LoginOptions = { netId?: string; daliEmail?: string; personalEmail?: string };

// The interactive guide (app/components/LaunchWelcome.tsx) is server-driven: it
// auto-opens only for a member with onboardedAt set and tourCompletedAt null.
// Seeded members have no onboardedAt, so it never opens here and there's
// nothing for the suite to suppress. If a future seed onboards its members,
// stamp tourCompletedAt on them rather than reaching for browser state.

export const test = base.extend<{ loginAs: (opts: LoginOptions) => Promise<void> }>({
  page: async ({ page, baseURL }, use) => {
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
