import { test, expect } from './fixtures';

test.describe('navigation for hiring lead', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'jordan.taylor@dali.dartmouth.edu' });
  });

  test('shows hiring lead and domain lead nav tabs', async ({ page }) => {
    await page.goto('/hiring/reviewer');
    const nav = page.locator('nav');
    await expect(nav.getByRole('button', { name: 'Reviews' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Domain' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Cycles' })).toBeVisible();
  });

  test('can navigate to cycles page', async ({ page }) => {
    await page.goto('/hiring/lead');
    await expect(page).toHaveURL(/\/hiring\/lead/);
    // The heading lives inside the workspace iframe for the Cycles section.
    const frame = page.frameLocator('iframe[title="Cycles"]');
    await expect(frame.getByRole('heading', { name: 'Hiring Cycles' })).toBeVisible();
  });
});

test.describe('navigation for domain lead', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'eng.lead@dali.dartmouth.edu' });
  });

  test('shows domain lead tab but not cycles', async ({ page }) => {
    await page.goto('/hiring/reviewer');
    const nav = page.locator('nav');
    await expect(nav.getByRole('button', { name: 'Reviews' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Domain' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Cycles' })).not.toBeVisible();
  });
});

test.describe('navigation for reviewer', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'reviewer1@dali.dartmouth.edu' });
  });

  test('shows reviews tab only', async ({ page }) => {
    await page.goto('/hiring/reviewer');
    const nav = page.locator('nav');
    await expect(nav.getByRole('button', { name: 'Reviews' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Domain' })).not.toBeVisible();
    await expect(nav.getByRole('button', { name: 'Cycles' })).not.toBeVisible();
  });
});
