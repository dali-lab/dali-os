import { test, expect } from './fixtures';

const ADMIN_EMAIL = 'admin@dali.dartmouth.edu';

// /admin-console/domains renders inside the workspace iframe titled "Domains".
const domainsFrame = (page: import('@playwright/test').Page) =>
  page.frameLocator('iframe[title="Domains"]');

test.describe('admin domain management', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: ADMIN_EMAIL });
  });

  test('admin can create a new domain and then delete it', async ({ page }) => {
    const name = `E2E Domain ${Date.now()}`;

    await page.goto('/admin-console/domains');
    const frame = domainsFrame(page);
    await expect(frame.getByText(/^Domains \(/)).toBeVisible();

    await frame.getByLabel('New domain name').fill(name);
    await frame.getByRole('button', { name: 'Create' }).click();

    const row = frame.getByRole('listitem').filter({ hasText: name });
    await expect(row).toBeVisible();
    await expect(row.getByText(/Not in use/)).toBeVisible();

    await row.getByRole('button', { name: 'Delete' }).click();
    await expect(row).toHaveCount(0);
  });

  test('delete is disabled for a seeded domain that is in use', async ({ page }) => {
    await page.goto('/admin-console/domains');
    const frame = domainsFrame(page);

    const engRow = frame.getByRole('listitem').filter({ hasText: /^Engineering/ });
    await expect(engRow).toBeVisible();
    await expect(engRow.getByText(/In use by/)).toBeVisible();
    await expect(engRow.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });
});

test.describe('non-admin domain management', () => {
  test('hiring lead cannot access admin console', async ({ loginAs, page }) => {
    await loginAs({ daliEmail: 'jordan.taylor@dali.dartmouth.edu' });
    await page.goto('/admin-console/members');
    await expect(page).not.toHaveURL(/admin-console/);
  });
});
