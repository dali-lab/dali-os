import { test, expect } from './fixtures';

test.describe('domain lead workflow', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'eng.lead@dali.dartmouth.edu' });
  });

  test('dashboard loads with engineering domain section', async ({ page }) => {
    await page.goto('/hiring/domain-lead');
    await expect(page.getByRole('heading', { name: 'Domain Lead Dashboard' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Engineering' }).first()).toBeVisible();
    await expect(page.getByText('Open').first()).toBeVisible();
  });

  test('shows applicants table with known applicants', async ({ page }) => {
    await page.goto('/hiring/domain-lead');
    await expect(page.getByRole('columnheader', { name: 'Applicant' }).first()).toBeVisible();
    await expect(page.getByText('Alice Johnson').first()).toBeVisible();
    await expect(page.getByText('Diego Rivera').first()).toBeVisible();
  });

  test('shows collapsible sections', async ({ page }) => {
    await page.goto('/hiring/domain-lead');
    // The cycle in seed is Open, so the challenge section reads "Challenges (locked)".
    // The old "Reviews" section was split into separate Rubric and Team sections.
    await expect(page.getByText(/Challenges \((setup|locked)\)/).first()).toBeVisible();
    await expect(page.getByText('Rubric').first()).toBeVisible();
    await expect(page.getByText('Team').first()).toBeVisible();
    await expect(page.getByText('Applications').first()).toBeVisible();
  });

  test('application detail page shows challenge responses', async ({ page }) => {
    await page.goto('/hiring/domain-lead/application/da-alice-eng');
    await expect(page.getByRole('heading', { name: 'Alice Johnson' })).toBeVisible();
    await expect(page.getByText('General Application')).toBeVisible();
    await expect(page.getByText('Engineering Challenge')).toBeVisible();
  });

  test('Library nav links domain lead to challenges and rubrics', async ({ page }) => {
    await page.goto('/hiring/domain-lead');
    await page.getByRole('link', { name: 'Library' }).click();
    await expect(page).toHaveURL(/\/hiring\/challenges/);
    await page.getByRole('link', { name: 'Rubrics' }).click();
    await expect(page).toHaveURL(/\/hiring\/rubrics/);
    await expect(page.getByRole('heading', { name: 'Evaluation Rubrics' })).toBeVisible();
  });
});
