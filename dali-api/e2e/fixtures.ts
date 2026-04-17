import { test as base } from '@playwright/test';

type LoginOptions = { netId?: string; daliEmail?: string };

export const test = base.extend<{ loginAs: (opts: LoginOptions) => Promise<void> }>({
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
