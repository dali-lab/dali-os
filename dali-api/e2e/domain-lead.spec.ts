import { test, expect } from './fixtures';

test.describe('domain lead workflow', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'eng.lead@dali.dartmouth.edu' });
  });

  test('dashboard loads with engineering domain section', async ({ page }) => {
    await page.goto('/domain-lead');
    await expect(page.getByRole('heading', { name: 'Domain Lead Dashboard' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Engineering' }).first()).toBeVisible();
    await expect(page.getByText('Open').first()).toBeVisible();
  });

  test('shows applicants table with known applicants', async ({ page }) => {
    await page.goto('/domain-lead');
    await expect(page.getByRole('columnheader', { name: 'Applicant' }).first()).toBeVisible();
    await expect(page.getByText('Alice Johnson').first()).toBeVisible();
    await expect(page.getByText('Diego Rivera').first()).toBeVisible();
  });

  test('shows collapsible sections', async ({ page }) => {
    await page.goto('/domain-lead');
    await expect(page.getByText('Setup').first()).toBeVisible();
    await expect(page.getByText('Team').first()).toBeVisible();
    await expect(page.getByText('Applications').first()).toBeVisible();
  });

  test('application detail page shows challenge responses', async ({ page }) => {
    await page.goto('/domain-lead/application/da-alice-eng');
    await expect(page.getByRole('heading', { name: 'Alice Johnson' })).toBeVisible();
    await expect(page.getByText('General Application')).toBeVisible();
    await expect(page.getByText('Engineering Challenge')).toBeVisible();
  });
});
