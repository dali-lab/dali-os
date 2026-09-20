import { test, expect } from './fixtures';

// Section content is rendered inside an iframe inside the workspace shell.
// The Hiring sidebar area is childless, so direct navigation seeds the tab
// with the area label ("Hiring"); lateral moves between hiring tools happen
// via the in-page pill row and keep the same iframe.
const domainFrame = (page: import('@playwright/test').Page) =>
  page.frameLocator('iframe[title="Hiring"]');

test.describe('domain lead workflow', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'eng.lead@dali.dartmouth.edu' });
  });

  test('dashboard is titled by the domain', async ({ page }) => {
    await page.goto('/hiring/domain-lead');
    const frame = domainFrame(page);
    await expect(frame.getByRole('heading', { level: 1, name: 'Engineering' })).toBeVisible();
    await expect(frame.getByText('Open').first()).toBeVisible();
  });

  test('shows known applicants on the dashboard', async ({ page }) => {
    await page.goto('/hiring/domain-lead');
    const frame = domainFrame(page);
    // Alice and Diego are seeded as invited-to-interview. After the redesign
    // they appear in the Interviews section rather than the (renamed) Reviews
    // table, but either way their names are visible on the domain dashboard.
    await expect(frame.getByText('Interviews').first()).toBeVisible();
    await expect(frame.getByText('Alice Johnson').first()).toBeVisible();
    await expect(frame.getByText('Diego Rivera').first()).toBeVisible();
  });

  test('shows each section as a card', async ({ page }) => {
    await page.goto('/hiring/domain-lead');
    const frame = domainFrame(page);
    for (const name of ['Challenges', 'Rubric', 'Reviewers', 'Reviews']) {
      await expect(frame.getByRole('heading', { name, exact: true }).first()).toBeVisible();
    }
  });

  test('application detail page shows challenge responses', async ({ page }) => {
    await page.goto('/hiring/domain-lead/application/da-alice-eng');
    // Detail page also opens inside the Domain section iframe.
    const frame = domainFrame(page);
    await expect(frame.getByRole('heading', { name: 'Alice Johnson' })).toBeVisible();
    await expect(frame.getByText('General information')).toBeVisible();
    await expect(frame.getByText('Engineering challenge')).toBeVisible();
  });

  // (Removed) "reach Rubrics via the hiring pills" — the Library pill was folded
  // into the Hiring drive; rubrics now live in /drive, not a Library tab.
});
