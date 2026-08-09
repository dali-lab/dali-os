import { test, expect } from './fixtures';

// The /hiring hub: role-aware status cards + the embedded pipeline. Lateral
// navigation between hiring tools now lives in the sidebar (see nav.spec.ts),
// not an in-page pill row — and this hub is loaded embedded (no sidebar).

test.describe('hiring hub', () => {
  test('Core sees the hub with cycle status and pipeline', async ({
    page,
    loginAs,
  }) => {
    await loginAs({ daliEmail: 'jordan.taylor@dali.dartmouth.edu' });
    await page.goto('/hiring?embed=1');
    await expect(page.getByRole('heading', { name: 'Hiring', exact: true })).toBeVisible();
    // Seeded Fall 2026 cycle surfaces in the header line. The embedded
    // pipeline's cycle selector also carries the name, so scope to the
    // header rather than the whole page.
    await expect(
      page.locator('header').getByText(/Fall 2026/),
    ).toBeVisible();
    // The pipeline section (formerly /hiring/analytics) is embedded below.
    await expect(
      page.getByRole('heading', { name: 'Pipeline', exact: true }),
    ).toBeVisible();
  });

  test('non-hiring member is bounced home', async ({ page, loginAs }) => {
    // Seeded portal students have no hiring roles at all.
    await loginAs({ netId: 'f007al1' });
    await page.goto('/hiring');
    await expect(page).not.toHaveURL(/\/hiring/);
  });
});
