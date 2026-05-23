import { test, expect } from './fixtures';

// Section content lives inside the workspace iframe; for /hiring/lead the
// iframe title is "Cycles". Internal navigations within the section keep
// the same iframe (and therefore the same title).
const cyclesFrame = (page: import('@playwright/test').Page) =>
  page.frameLocator('iframe[title="Cycles"]');

test.describe('hiring lead workflow', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'jordan.taylor@dali.dartmouth.edu' });
  });

  test('cycles list shows active cycle and controls', async ({ page }) => {
    await page.goto('/hiring/lead');
    const frame = cyclesFrame(page);
    await expect(frame.getByRole('heading', { name: 'Hiring Cycles' })).toBeVisible();
    await expect(frame.getByRole('button', { name: /New Cycle/ })).toBeVisible();
    await expect(frame.getByText('Fall 2026').first()).toBeVisible();
    await expect(frame.getByText('Open').first()).toBeVisible();
  });

  test('can navigate to cycle detail', async ({ page }) => {
    await page.goto('/hiring/lead');
    const frame = cyclesFrame(page);
    await frame.getByRole('link', { name: /Fall 2026/ }).click();
    // The iframe navigates to the cycle detail; verify by content rather
    // than by the outer page URL (which stays at /hiring/lead).
    await expect(frame.getByRole('button', { name: 'Setup' })).toBeVisible();
  });

  test('cycle detail shows management tabs', async ({ page }) => {
    await page.goto('/hiring/lead');
    const frame = cyclesFrame(page);
    await frame.getByRole('link', { name: /Fall 2026/ }).click();

    await expect(frame.getByRole('button', { name: 'Overview' })).toBeVisible();
    await expect(frame.getByRole('button', { name: 'Setup' })).toBeVisible();
    // Use .first() for Interviews/Reviewers/Decisions: the overview panel renders count-card
    // buttons whose accessible names contain these substrings ("Scheduled interviews",
    // "Reviewers", "Decisions to release"). Tab nav renders before the content, so .first()
    // reliably selects the tab button.
    await expect(frame.getByRole('button', { name: 'Interviews' }).first()).toBeVisible();
    await expect(frame.getByRole('button', { name: 'Reviewers' }).first()).toBeVisible();
    await expect(frame.getByRole('button', { name: 'Decisions' }).first()).toBeVisible();
  });

  test('cycle setup tab shows domains', async ({ page }) => {
    await page.goto('/hiring/lead');
    const frame = cyclesFrame(page);
    await frame.getByRole('link', { name: /Fall 2026/ }).click();

    await expect(frame.getByText('Engineering').first()).toBeVisible();
    await expect(frame.getByText('Design').first()).toBeVisible();
    await expect(frame.getByText('Product').first()).toBeVisible();
  });

  test('interview setup tab shows config fields', async ({ page }) => {
    await page.goto('/hiring/lead');
    const frame = cyclesFrame(page);
    await frame.getByRole('link', { name: /Fall 2026/ }).click();
    // Use .first(): overview count cards include "Scheduled interviews" which also matches.
    await frame.getByRole('button', { name: 'Interviews' }).first().click();

    await expect(frame.getByText('Slot Duration')).toBeVisible();
    await expect(frame.getByText('Buffer Between Interviews')).toBeVisible();
  });

  test('decisions tab shows finalized decisions', async ({ page }) => {
    await page.goto('/hiring/lead');
    const frame = cyclesFrame(page);
    await frame.getByRole('link', { name: /Fall 2026/ }).click();
    // Use .first() because the overview panel also renders a "Decisions to release" count card button.
    await frame.getByRole('button', { name: 'Decisions' }).first().click();

    await expect(frame.getByText('Alice Johnson').first()).toBeVisible();
  });
});
