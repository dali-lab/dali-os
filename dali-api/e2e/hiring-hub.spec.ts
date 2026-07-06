import { test, expect } from './fixtures';

// The /hiring hub: role-aware status cards + the hiring pill row (the
// sidebar's Hiring entry is childless and lands here).

test.describe('hiring hub', () => {
  test('Core sees the hub with cycle status and lateral pills', async ({
    page,
    loginAs,
  }) => {
    await loginAs({ daliEmail: 'jordan.taylor@dali.dartmouth.edu' });
    await page.goto('/hiring?embed=1');
    await expect(page.getByRole('heading', { name: 'Hiring', exact: true })).toBeVisible();
    // Pill row reaches the tools.
    await expect(page.getByRole('link', { name: 'Reviews' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Cycles' })).toBeVisible();
    // Seeded Fall 2026 cycle surfaces in the header line.
    await expect(page.getByText(/Fall 2026/)).toBeVisible();
  });

  test('non-hiring member is bounced home', async ({ page, loginAs }) => {
    // Seeded portal students have no hiring roles at all.
    await loginAs({ netId: 'f007al1' });
    await page.goto('/hiring');
    await expect(page).not.toHaveURL(/\/hiring/);
  });
});
