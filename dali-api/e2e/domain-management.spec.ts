import { test, expect } from './fixtures';

const ADMIN_EMAIL = 'admin@dali.dartmouth.edu';

// Domain management lives at /core/access/domains — nav-regroup (on for
// everyone) moved the lab-process pages out of Admin into Core, and
// /admin/domains redirects here. It renders inside the workspace iframe,
// which is seeded with the area label.
const DOMAINS_URL = '/core/access/domains';
const domainsFrame = (page: import('@playwright/test').Page) =>
  page.frameLocator('iframe[title="Core"]');

test.describe('admin domain management', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: ADMIN_EMAIL });
  });

  test('admin can create a new domain and then delete it', async ({ page }) => {
    const name = `E2E Domain ${Date.now()}`;

    await page.goto(DOMAINS_URL);
    const frame = domainsFrame(page);
    await expect(frame.getByRole('heading', { name: 'Domains' })).toBeVisible();

    await frame.getByLabel('New domain name').fill(name);
    await frame.getByRole('button', { name: 'Add domain' }).click();

    const row = frame.getByRole('listitem').filter({ hasText: name });
    await expect(row).toBeVisible();
    await expect(row.getByText('Unused')).toBeVisible();

    await row.getByRole('button', { name: 'Delete' }).click();
    await expect(row).toHaveCount(0);
  });

  test('delete is disabled for a seeded domain that is in use', async ({ page }) => {
    await page.goto(DOMAINS_URL);
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
  test('hiring lead (Core) can access the member roles page', async ({ loginAs, page }) => {
    await loginAs({ daliEmail: 'jordan.taylor@dali.dartmouth.edu' });
    // /admin/members redirects to its Core home under nav-regroup.
    await page.goto('/admin/members');
    await expect(page).toHaveURL(/\/core\/access\/roles/);
  });

  // A lab member with neither Core nor Admin is still redirected away.
  test('non-Core, non-Admin lab member cannot access admin console', async ({ loginAs, page }) => {
    await loginAs({ daliEmail: 'reviewer1@dali.dartmouth.edu' });
    await page.goto('/admin/members');
    await expect(page).not.toHaveURL(/admin/);
  });
});
