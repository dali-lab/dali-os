import { test, expect } from './fixtures';

test.describe('domain lead workflow', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'eng.lead@dali.dartmouth.edu' });
  });

  test('dashboard is titled by the domain', async ({ page }) => {
    await page.goto('/hiring/domain-lead');
    await expect(page.getByRole('heading', { level: 1, name: 'Engineering' })).toBeVisible();
    await expect(page.getByText('Open').first()).toBeVisible();
    // The page-wide "Domain Lead Dashboard" heading and the card that wrapped
    // every section are gone; the domain name is the title.
    await expect(page.getByText('Domain Lead Dashboard')).toHaveCount(0);
  });

  test('reviewer roster can be filled from the domain mentors', async ({ page }) => {
    await page.goto('/hiring/domain-lead');
    await expect(page.getByRole('heading', { name: 'Reviewers', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add all mentors' }).first()).toBeVisible();
  });

  test('shows known applicants on the dashboard', async ({ page }) => {
    await page.goto('/hiring/domain-lead');
    // Alice and Diego are seeded as invited-to-interview. After the redesign
    // they appear in the Interviews section rather than the (renamed) Reviews
    // table, but either way their names are visible on the domain dashboard.
    await expect(page.getByText('Interviews').first()).toBeVisible();
    await expect(page.getByText('Alice Johnson').first()).toBeVisible();
    await expect(page.getByText('Diego Rivera').first()).toBeVisible();
  });

  test('shows each section as a card', async ({ page }) => {
    await page.goto('/hiring/domain-lead');
    for (const name of ['Challenges', 'Rubric', 'Reviewers', 'Reviews']) {
      await expect(page.getByRole('heading', { name, exact: true }).first()).toBeVisible();
    }
  });

  test('application detail page shows challenge responses', async ({ page }) => {
    await page.goto('/hiring/domain-lead/application/da-alice-eng');
    // Fall 2026 is blind-reviewed and other specs advance it mid-run: Alice reads
    // as "Applicant N" while Engineering's window is open, by name after.
    await expect(page.getByRole('heading', { name: /^(Alice Johnson|Applicant \d+)$/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'General information' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Engineering challenge' })).toBeVisible();
    // Delibs are no longer their own section: every stage change is one
    // Decisions timeline, and a lead can move a stage without a delib.
    await expect(page.getByRole('heading', { name: 'Decisions', exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Move to stage' })).toBeVisible();
  });

  // (Removed) "reach Rubrics via the hiring pills" — the Library pill was folded
  // into the Hiring drive; rubrics now live in /drive, not a Library tab.
});
