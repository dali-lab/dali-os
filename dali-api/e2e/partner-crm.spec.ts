import { test, expect } from './fixtures';

// Core-side Partner CRM: board, modal, directory, org tabs, settings, and
// reports. Seeded data comes from prisma/seed.ts's "Partner applications"
// section — see there for the stable ids these tests rely on.

test.describe('partner CRM board (Core)', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });
  });

  test('renders four columns with the seeded cards', async ({ page }) => {
    await page.goto('/core/partners?embed=1');
    await expect(page.getByText('New', { exact: true })).toBeVisible();
    await expect(page.getByText('Interview', { exact: true })).toBeVisible();
    await expect(page.getByText('Accepted', { exact: true })).toBeVisible();
    await expect(page.getByText('Rejected', { exact: true })).toBeVisible();

    await expect(page.getByText('Interactive gallery kiosk')).toBeVisible();
    await expect(page.getByText('Alumni mentorship matching')).toBeVisible();
    await expect(page.getByText('Lab sensor dashboard')).toBeVisible();
  });

  test('clicking a card opens the modal with the title', async ({ page }) => {
    await page.goto('/core/partners?embed=1');
    await page.getByText('Interactive gallery kiosk', { exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Interactive gallery kiosk' }),
    ).toBeVisible();
  });
});

test.describe('partner directory (Core)', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });
  });

  test('lists orgs, then the contacts view', async ({ page }) => {
    await page.goto('/core/partners/directory?embed=1');
    await expect(page.getByRole('heading', { name: 'Partners' })).toBeVisible();
    await expect(page.getByText('Tuck School of Business')).toBeVisible();
    await expect(page.getByText('Hood Museum of Art')).toBeVisible();

    await page.getByRole('tab', { name: 'Contacts' }).click();
    await expect(page.getByText('Pat Tuck').first()).toBeVisible();
    await expect(page.getByText('Harper Hood').first()).toBeVisible();
  });
});

test.describe('partner org page tabs (Core)', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });
  });

  test('navigating tab URLs shows the matching section', async ({ page }) => {
    await page.goto('/core/partners/orgs/partner-tuck-school?tab=applications&embed=1');
    await expect(page.getByText('Alumni mentorship matching')).toBeVisible();

    await page.goto('/core/partners/orgs/partner-tuck-school?tab=contacts&embed=1');
    await expect(page.getByText('Pat Tuck').first()).toBeVisible();

    await page.goto('/core/partners/orgs/partner-tuck-school?tab=projects&embed=1');
    await expect(page.getByText('Tuck Alumni Connect')).toBeVisible();
  });
});

test.describe('partner CRM settings (Core)', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });
  });

  test('saves the stale threshold', async ({ page }) => {
    await page.goto('/core/partners/settings?embed=1');
    await page.getByRole('button', { name: 'Edit Interview scheduling' }).click();
    const staleInput = page.locator('input[name="staleDays"]');
    await staleInput.fill('21');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('21 days')).toBeVisible();
  });
});

test.describe('partner CRM reports (Core)', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });
  });

  test('renders headline tiles for every section', async ({ page }) => {
    await page.goto('/core/partners/reports?embed=1');
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Funnel' })).toBeVisible();
    await expect(page.getByText('Applications', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Cycle time' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Rejection reasons' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Partner mix' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Capacity' })).toBeVisible();
  });

  test('switching the term re-renders without an error', async ({ page }) => {
    await page.goto('/core/partners/reports?embed=1');
    await page.goto('/core/partners/reports?term=all&embed=1');
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  });
});
