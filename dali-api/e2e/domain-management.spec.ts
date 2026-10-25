import { test, expect } from './fixtures';

const ADMIN_EMAIL = 'admin@dali.dartmouth.edu';

// Domains are managed from Roles & domains at /core/access, in its
// "Manage domains" dialog; /core/access/domains and /admin/domains redirect
// here. It renders inside the workspace iframe, seeded with the area label.
const ACCESS_URL = '/core/access';
const accessFrame = (page: import('@playwright/test').Page) =>
  page.frameLocator('iframe[title="Core"]');

async function openManageDomains(page: import('@playwright/test').Page) {
  const frame = accessFrame(page);
  await frame.getByRole('button', { name: 'Manage domains' }).click();
  const dialog = frame.getByRole('dialog', { name: 'Manage domains' });
  await expect(dialog).toBeVisible();
  return { frame, dialog };
}

test.describe('admin domain management', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: ADMIN_EMAIL });
  });

  test('old domains URL lands on Roles & domains', async ({ page }) => {
    await page.goto('/core/access/domains');
    await expect(page).toHaveURL(/\/core\/access(\?|$)/);
  });

  test('admin can create a new domain and then delete it', async ({ page }) => {
    // First hit to this iframe route can cold-compile its client bundle, so
    // hydration (which wires the form's onChange) may lag well past the default.
    test.slow();
    const name = `E2E Domain ${Date.now()}`;

    await page.goto(ACCESS_URL);
    const { frame, dialog } = await openManageDomains(page);

    // A fill can land before React has wired the input's onChange (so the
    // button stays disabled). Re-fill until the button enables, then submit.
    const addBtn = dialog.getByRole('button', { name: 'Add domain' });
    await expect(async () => {
      await dialog.getByLabel('New domain name').fill(name);
      await expect(addBtn).toBeEnabled({ timeout: 2000 });
    }).toPass({ timeout: 45_000 });
    await addBtn.click();

    const row = dialog.getByRole('listitem').filter({ hasText: name });
    await expect(row).toBeVisible();
    await expect(row.getByText(/Not used by anything/)).toBeVisible();

    await row.getByRole('button', { name: `Delete ${name}` }).click();
    // The confirm opens over the Manage domains dialog, so pick it by name.
    await frame
      .getByRole('dialog', { name: `Delete ${name}?` })
      .getByRole('button', { name: 'Delete domain', exact: true })
      .click();
    await expect(row).toHaveCount(0);
  });

  test('delete is disabled for a seeded domain that is in use', async ({ page }) => {
    await page.goto(ACCESS_URL);
    const { dialog } = await openManageDomains(page);

    const engRow = dialog.getByRole('listitem').filter({ hasText: /^Engineering/ });
    await expect(engRow).toBeVisible();
    await expect(engRow.getByText(/Used by/)).toBeVisible();
    await expect(engRow.getByRole('button', { name: 'Delete Engineering' })).toBeDisabled();
  });
});

test.describe('admin console access tiers', () => {
  // Core (Hiring Lead title) can reach Roles & domains so they can manage Core titles, Domain Leads, and
  // member eligibilities without needing Admin. Admin-only actions
  // (set-admin, create-domain, delete-domain) still 403 inside the action
  // handler.
  test('hiring lead (Core) can access the member roles page', async ({ loginAs, page }) => {
    await loginAs({ daliEmail: 'jordan.taylor@dali.dartmouth.edu' });
    // /admin/members redirects to Roles & domains.
    await page.goto('/admin/members');
    await expect(page).toHaveURL(/\/core\/access(\?|$)/);
  });

  // A lab member with neither Core nor Admin is still redirected away.
  test('non-Core, non-Admin lab member cannot access admin console', async ({ loginAs, page }) => {
    await loginAs({ daliEmail: 'reviewer1@dali.dartmouth.edu' });
    await page.goto('/admin/members');
    await expect(page).not.toHaveURL(/admin/);
  });
});
