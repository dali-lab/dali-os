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

  test('shows known applicants on the dashboard', async ({ page }) => {
    await page.goto('/hiring/domain-lead');
    const frame = domainFrame(page);
    // Alice and Diego are seeded as invited-to-interview, so they now appear in
    // the Interviews section (the Reviews section is scoped to under-review /
    // rejected applicants — invited applicants live only under Interviews).
    await expect(frame.getByRole('heading', { name: 'Interviews' }).first()).toBeVisible();
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

  test('domain lead can reach Rubrics from the sidebar', async ({ page }) => {
    await page.goto('/hiring/domain-lead');
    // Challenges / Rubrics / Agreements were consolidated into one "Library"
    // page with tabs. The sidebar Library button opens a "Library" workspace
    // tab; Rubrics live behind the in-page Rubrics tab.
    await page.getByRole('button', { name: 'Library' }).click();
    const libraryFrame = page.frameLocator('iframe[title="Library"]');
    // Wait for the Library route to finish loading inside the iframe before
    // interacting — otherwise the Rubrics tab click can race the iframe's
    // navigation and land on a not-yet-ready frame.
    const rubricsTab = libraryFrame.getByRole('tab', { name: 'Rubrics' });
    await expect(rubricsTab).toBeVisible();
    await rubricsTab.click();
    await expect(libraryFrame.getByRole('heading', { name: 'Evaluation Rubrics' })).toBeVisible();
  });
});
