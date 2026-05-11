import { test, expect } from './fixtures';

// Section content is rendered inside an iframe inside the workspace shell.
// The iframe title matches the sidebar label for the workspace tab.
const domainFrame = (page: import('@playwright/test').Page) =>
  page.frameLocator('iframe[title="Domain"]');

test.describe('domain lead workflow', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'eng.lead@dali.dartmouth.edu' });
  });

  test('dashboard loads with engineering domain section', async ({ page }) => {
    await page.goto('/hiring/domain-lead');
    const frame = domainFrame(page);
    await expect(frame.getByRole('heading', { name: 'Domain Lead Dashboard' })).toBeVisible();
    await expect(frame.getByRole('heading', { name: 'Engineering' }).first()).toBeVisible();
    await expect(frame.getByText('Open').first()).toBeVisible();
  });

  test('shows applicants table with known applicants', async ({ page }) => {
    await page.goto('/hiring/domain-lead');
    const frame = domainFrame(page);
    await expect(frame.getByRole('columnheader', { name: 'Applicant' }).first()).toBeVisible();
    await expect(frame.getByText('Alice Johnson').first()).toBeVisible();
    await expect(frame.getByText('Diego Rivera').first()).toBeVisible();
  });

  test('shows collapsible sections', async ({ page }) => {
    await page.goto('/hiring/domain-lead');
    const frame = domainFrame(page);
    // The cycle in seed is Open, so the challenge section reads "Challenges (locked)".
    // The old "Reviews" section was split into separate Rubric and Team sections.
    await expect(frame.getByText(/Challenges \((setup|locked)\)/).first()).toBeVisible();
    await expect(frame.getByText('Rubric').first()).toBeVisible();
    await expect(frame.getByText('Team').first()).toBeVisible();
    await expect(frame.getByText('Applications').first()).toBeVisible();
  });

  test('application detail page shows challenge responses', async ({ page }) => {
    await page.goto('/hiring/domain-lead/application/da-alice-eng');
    // Detail page also opens inside the Domain section iframe.
    const frame = domainFrame(page);
    await expect(frame.getByRole('heading', { name: 'Alice Johnson' })).toBeVisible();
    await expect(frame.getByText('General Application')).toBeVisible();
    await expect(frame.getByText('Engineering Challenge')).toBeVisible();
  });

  test('Library nav links domain lead to challenges and rubrics', async ({ page }) => {
    await page.goto('/hiring/domain-lead');
    // Library is a link inside the Domain section. Clicking navigates the
    // iframe to /hiring/challenges; the workspace tab title stays "Domain".
    const frame = domainFrame(page);
    await frame.getByRole('link', { name: 'Library' }).click();
    await frame.getByRole('link', { name: 'Rubrics' }).click();
    await expect(frame.getByRole('heading', { name: 'Evaluation Rubrics' })).toBeVisible();
  });
});
