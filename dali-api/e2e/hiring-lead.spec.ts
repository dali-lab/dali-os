import { test, expect } from './fixtures';

// Section content lives inside the workspace iframe. The Hiring sidebar area
// is childless, so a direct navigation seeds the tab with the area label
// ("Hiring"); internal navigations within the section keep the same iframe.
const cyclesFrame = (page: import('@playwright/test').Page) =>
  page.frameLocator('iframe[title="Hiring"]');

test.describe('hiring lead workflow', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'jordan.taylor@dali.dartmouth.edu' });
  });

  test('cycles list shows active cycle and controls', async ({ page }) => {
    await page.goto('/hiring/lead');
    const frame = cyclesFrame(page);
    await expect(frame.getByRole('heading', { name: 'Cycles', exact: true })).toBeVisible();
    await expect(frame.getByRole('button', { name: /New cycle/ })).toBeVisible();
    await expect(frame.getByText('Fall 2026').first()).toBeVisible();
    await expect(frame.getByText('Open').first()).toBeVisible();
  });

  test('can navigate to cycle detail', async ({ page }) => {
    await page.goto('/hiring/lead');
    const frame = cyclesFrame(page);
    await frame.getByRole('link', { name: /Fall 2026/ }).click();
    // The iframe navigates to the cycle detail; verify by content rather
    // than by the outer page URL (which stays at /hiring/lead).
    await expect(frame.getByRole('tab', { name: 'Setup', exact: true })).toBeVisible();
  });

  test('cycle detail shows a tab per timeline block, by name', async ({ page }) => {
    await page.goto('/hiring/lead');
    const frame = cyclesFrame(page);
    await frame.getByRole('link', { name: /Fall 2026/ }).click();

    // Tabs are the timeline's blocks, by name. The seeded cycle uses the
    // standard timeline.
    for (const name of ['Setup', 'Review', 'First delib', 'Interviews', 'Final delib', 'Decisions']) {
      await expect(frame.getByRole('tab', { name, exact: true })).toBeVisible();
    }
  });

  test('cycle setup tab shows domains', async ({ page }) => {
    await page.goto('/hiring/lead');
    const frame = cyclesFrame(page);
    await frame.getByRole('link', { name: /Fall 2026/ }).click();
    await frame.getByRole('tab', { name: 'Setup', exact: true }).click();

    await expect(frame.getByText('Engineering').first()).toBeVisible();
    await expect(frame.getByText('Design').first()).toBeVisible();
    await expect(frame.getByText('Product').first()).toBeVisible();
  });

  test('interviews phase shows the interview schedule config', async ({ page }) => {
    await page.goto('/hiring/lead');
    const frame = cyclesFrame(page);
    await frame.getByRole('link', { name: /Fall 2026/ }).click();
    await frame.getByRole('tab', { name: 'Interviews', exact: true }).click();

    await expect(frame.getByRole('button', { name: 'Slot length' })).toBeVisible();
    await expect(frame.getByRole('button', { name: 'Buffer between interviews' })).toBeVisible();
  });

  test('setup tab stacks its sections as cards', async ({ page }) => {
    await page.goto('/hiring/lead');
    const frame = cyclesFrame(page);
    await frame.getByRole('link', { name: /Fall 2026/ }).click();
    await frame.getByRole('tab', { name: 'Setup', exact: true }).click();

    // Setup owns the term, the audience and the editable timeline. (The side
    // nav beside them only renders at lg and up, so it isn't asserted here —
    // the workspace iframe is narrower than the viewport.)
    for (const name of ['Term and dates', 'Audience', 'Timeline']) {
      await expect(frame.getByRole('heading', { name, exact: true })).toBeVisible();
    }
  });

  test('a decision email opens in a modal, shared across cycles', async ({ page }) => {
    await page.goto('/hiring/lead');
    const frame = cyclesFrame(page);
    await frame.getByRole('link', { name: /Fall 2026/ }).click();
    await frame.getByRole('tab', { name: 'Setup', exact: true }).click();

    // Emails are one shared row per slot; the seed writes a Rejected email, so
    // its row offers Edit rather than Write.
    const row = frame.getByText('Sent when a rejection is released.').locator('xpath=../..');
    await row.getByRole('button', { name: /^(Edit|Write)$/ }).click();

    const dialog = frame.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Rejected email' })).toBeVisible();
    await expect(dialog.getByLabel('Rejected subject')).toBeVisible();
    await expect(dialog.getByLabel('Rejected body')).toBeVisible();
    // Read-only check: saving would rewrite the email every cycle shares.
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('review tab holds the reviewer and interviewer rosters', async ({ page }) => {
    await page.goto('/hiring/lead');
    const frame = cyclesFrame(page);
    await frame.getByRole('link', { name: /Fall 2026/ }).click();
    await frame.getByRole('tab', { name: 'Review', exact: true }).click();

    await expect(frame.getByRole('heading', { name: 'Reviewers', exact: true })).toBeVisible();
    await expect(frame.getByRole('heading', { name: 'Interviewers', exact: true })).toBeVisible();
    // A Students cycle can fill a domain's roster from its mentors.
    await expect(frame.getByRole('button', { name: 'Add all mentors' }).first()).toBeVisible();
  });

  test('decisions tab lists finalized decisions waiting to be sent', async ({ page }) => {
    await page.goto('/hiring/lead');
    const frame = cyclesFrame(page);
    await frame.getByRole('link', { name: /Fall 2026/ }).click();
    await frame.getByRole('tab', { name: 'Decisions', exact: true }).click();

    // Grace's Final "Rejected" decision is seeded unreleased.
    await expect(frame.getByText('Grace Okafor').first()).toBeVisible();
  });
});
