import { test, expect } from './fixtures';

// /hiring is My work: the viewer's reviews, interviews and live delibs mirror.
// ?embed=1 renders the page without the shell.

test.describe('hiring my work', () => {
  test('a reviewer lands on their review queue', async ({ page, loginAs }) => {
    await loginAs({ daliEmail: 'reviewer1@dali.dartmouth.edu' });
    await page.goto('/hiring?embed=1');
    await expect(page.getByRole('heading', { name: 'My work', exact: true })).toBeVisible();
    await expect(page.getByText(/^Pending$|assigned applications yet/).first()).toBeVisible({ timeout: 10_000 });
  });

  test('old Reviews URL redirects into My work', async ({ page, loginAs }) => {
    await loginAs({ daliEmail: 'reviewer1@dali.dartmouth.edu' });
    await page.goto('/hiring/reviewer?embed=1');
    await expect(page).toHaveURL(/\/hiring\?.*view=reviews/);
  });

  test('non-hiring member is bounced home', async ({ page, loginAs }) => {
    // Seeded portal students have no hiring roles at all.
    await loginAs({ netId: 'f007al1' });
    await page.goto('/hiring');
    await expect(page).not.toHaveURL(/\/hiring/);
  });
});
