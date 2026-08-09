import { test, expect } from './fixtures';

// Hiring navigation after the sidebar redesign: the sidebar's single
// "active area" dropdown auto-follows the route, so on /hiring it reads
// "Hiring" and lists that area's role-gated tools (Reviews / Applications /
// Domain / Cycles / Library / …) as vertical children. These are sidebar
// <button>s in the top-level <aside>, no longer an in-iframe pill row.
const aside = (page: import('@playwright/test').Page) => page.locator('aside');

const hiringFrame = (page: import('@playwright/test').Page) =>
  page.frameLocator('iframe[title="Hiring"]');

test.describe('navigation for hiring lead', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'jordan.taylor@dali.dartmouth.edu' });
  });

  test('sidebar shows Hiring with its tools as children', async ({ page }) => {
    await page.goto('/hiring');
    await expect(aside(page).getByRole('button', { name: 'Hiring' })).toBeVisible();
    await expect(aside(page).getByRole('button', { name: 'Reviews' })).toBeVisible();
    await expect(aside(page).getByRole('button', { name: 'Domain' })).toBeVisible();
    await expect(aside(page).getByRole('button', { name: 'Cycles' })).toBeVisible();
    await expect(aside(page).getByRole('button', { name: 'Library' })).toBeVisible();
  });

  test('can navigate to cycles page', async ({ page }) => {
    await page.goto('/hiring/lead');
    await expect(page).toHaveURL(/\/hiring\/lead/);
    const frame = hiringFrame(page);
    await expect(frame.getByRole('heading', { name: 'Hiring Cycles' })).toBeVisible();
  });
});

test.describe('navigation for domain lead', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'eng.lead@dali.dartmouth.edu' });
  });

  test('sidebar tools show Domain but not Cycles', async ({ page }) => {
    await page.goto('/hiring');
    await expect(aside(page).getByRole('button', { name: 'Reviews' })).toBeVisible();
    await expect(aside(page).getByRole('button', { name: 'Domain' })).toBeVisible();
    await expect(aside(page).getByRole('button', { name: 'Cycles' })).not.toBeVisible();
  });
});

test.describe('navigation for reviewer', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'reviewer1@dali.dartmouth.edu' });
  });

  test('sidebar tools show Reviews but not Domain or Cycles', async ({ page }) => {
    await page.goto('/hiring');
    await expect(aside(page).getByRole('button', { name: 'Reviews' })).toBeVisible();
    await expect(aside(page).getByRole('button', { name: 'Domain' })).not.toBeVisible();
    await expect(aside(page).getByRole('button', { name: 'Cycles' })).not.toBeVisible();
  });
});
