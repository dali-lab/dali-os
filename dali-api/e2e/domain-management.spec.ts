import { test, expect } from './fixtures';

const ADMIN_EMAIL = 'admin@dali.dartmouth.edu';

// /admin/domains renders inside the workspace iframe. The Admin
// sidebar area is childless, so the tab is seeded with the area label.
const domainsFrame = (page: import('@playwright/test').Page) =>
  page.frameLocator('iframe[title="Admin"]');

test.describe('admin domain management', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: ADMIN_EMAIL });
  });

  test('admin can create a new domain and then delete it', async ({ page }) => {
    const name = `E2E Domain ${Date.now()}`;

    await page.goto('/admin/domains');
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
    await page.goto('/admin/domains');
    const frame = domainsFrame(page);

    const engRow = frame.getByRole('listitem').filter({ hasText: /^Engineering/ });
    await expect(engRow).toBeVisible();
    await expect(engRow.getByText(/In use by/)).toBeVisible();
    await expect(engRow.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });
});

test.describe('admin console access tiers', () => {
  // Core (Hiring Lead title) gained access to admin/members and
  // admin/domains so they can manage Core titles, Domain Leads, and
  // member eligibilities without needing Admin. Admin-only actions
  // (set-admin, create-domain, delete-domain) still 403 inside the action
  // handler.
  test('hiring lead (Core) can access admin console members', async ({ loginAs, page }) => {
    await loginAs({ daliEmail: 'jordan.taylor@dali.dartmouth.edu' });
    await page.goto('/admin/members');
    await expect(page).toHaveURL(/\/admin\/members/);
  });

  // A lab member with neither Core nor Admin is still redirected away.
  test('non-Core, non-Admin lab member cannot access admin console', async ({ loginAs, page }) => {
    await loginAs({ daliEmail: 'reviewer1@dali.dartmouth.edu' });
    await page.goto('/admin/members');
    await expect(page).not.toHaveURL(/admin/);
  });
});
