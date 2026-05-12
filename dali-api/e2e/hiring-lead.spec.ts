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
    await expect(frame.getByRole('button', { name: 'Cycle Setup' })).toBeVisible();
  });

  test('cycle detail shows management tabs', async ({ page }) => {
    await page.goto('/hiring/lead');
    const frame = cyclesFrame(page);
    await frame.getByRole('link', { name: /Fall 2026/ }).click();

    await expect(frame.getByRole('button', { name: 'Cycle Setup' })).toBeVisible();
    await expect(frame.getByRole('button', { name: 'Interview Setup' })).toBeVisible();
    await expect(frame.getByRole('button', { name: 'Reviewer Roster' })).toBeVisible();
    await expect(frame.getByRole('button', { name: 'Interview Dashboard' })).toBeVisible();
    await expect(frame.getByRole('button', { name: 'Decisions' })).toBeVisible();
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
    await frame.getByRole('button', { name: 'Interview Setup' }).click();

    await expect(frame.getByText('Slot Duration')).toBeVisible();
    await expect(frame.getByText('Buffer Between Interviews')).toBeVisible();
  });

  test('decisions tab shows finalized decisions', async ({ page }) => {
    await page.goto('/hiring/lead');
    const frame = cyclesFrame(page);
    await frame.getByRole('link', { name: /Fall 2026/ }).click();
    await frame.getByRole('button', { name: 'Decisions' }).click();

    await expect(frame.getByText('Alice Johnson').first()).toBeVisible();
  });
});
