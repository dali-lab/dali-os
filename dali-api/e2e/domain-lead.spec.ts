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

  test('dashboard loads with engineering domain section', async ({ page }) => {
    await page.goto('/hiring/domain-lead');
    const frame = domainFrame(page);
    await expect(frame.getByRole('heading', { name: 'Domain Lead Dashboard' })).toBeVisible();
    await expect(frame.getByRole('heading', { name: 'Engineering' }).first()).toBeVisible();
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

  test('shows collapsible sections', async ({ page }) => {
    await page.goto('/hiring/domain-lead');
    const frame = domainFrame(page);
    // The cycle in seed is Open, so the challenge section reads "Challenges (locked)".
    // The old "Reviews" section was split into separate Rubric and Team sections.
    await expect(frame.getByText(/Challenges \((setup|locked)\)/).first()).toBeVisible();
    await expect(frame.getByText('Rubric').first()).toBeVisible();
    await expect(frame.getByText('Team').first()).toBeVisible();
    // "Applications" was renamed to "Reviews".
    await expect(frame.getByText('Reviews').first()).toBeVisible();
  });

  test('application detail page shows challenge responses', async ({ page }) => {
    await page.goto('/hiring/domain-lead/application/da-alice-eng');
    // Detail page also opens inside the Domain section iframe.
    const frame = domainFrame(page);
    await expect(frame.getByRole('heading', { name: 'Alice Johnson' })).toBeVisible();
    await expect(frame.getByText('General Information')).toBeVisible();
    await expect(frame.getByText('Engineering Challenge')).toBeVisible();
  });

  test('domain lead can reach Rubrics via the hiring pills', async ({ page }) => {
    await page.goto('/hiring/domain-lead');
    const frame = domainFrame(page);
    // The sidebar Library entry is gone — lateral navigation between hiring
    // tools is the in-page pill row, which navigates within the same iframe.
    await frame.getByRole('link', { name: 'Library' }).click();
    // Wait for the Library route to finish loading inside the iframe before
    // interacting — otherwise the Rubrics tab click can race the iframe's
    // navigation and land on a not-yet-ready frame.
    const rubricsTab = frame.getByRole('tab', { name: 'Rubrics' });
    await expect(rubricsTab).toBeVisible();
    await rubricsTab.click();
    await expect(frame.getByRole('heading', { name: 'Evaluation Rubrics' })).toBeVisible();
  });
});
