import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './fixtures';

// Representative authenticated surfaces. The fixture's dev-login-as flow
// accepts either a Dartmouth netId (applicant) or a DALI email (member).
type LoginSpec = { netId?: string; daliEmail?: string };

const ROUTES: Array<{ path: string; login?: LoginSpec }> = [
  { path: '/login' },
  { path: '/portal', login: { netId: 'f007ca3' } },
  { path: '/portal/apply', login: { netId: 'f007ca3' } },
  { path: '/hiring/reviewer', login: { daliEmail: 'admin@dali.dartmouth.edu' } },
  { path: '/hiring/domain-lead', login: { daliEmail: 'eng.lead@dali.dartmouth.edu' } },
];

const SCHEMES: Array<'light' | 'dark'> = ['light', 'dark'];

for (const scheme of SCHEMES) {
  for (const { path, login } of ROUTES) {
    test(`a11y color-contrast ${scheme} ${path}`, async ({ page, loginAs }) => {
      await page.emulateMedia({ colorScheme: scheme });
      if (login) await loginAs(login);
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      const results = await new AxeBuilder({ page })
        .withRules(['color-contrast'])
        .analyze();

      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
    });
  }
}
