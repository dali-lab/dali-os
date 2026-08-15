import { test, expect } from './fixtures';

// Hiring navigation: the sidebar's Hiring entry lands on the /hiring hub and
// carries the role-gated tools (Reviews / Interviews / Applications / Domain /
// Cycles / Waitlists / Onboarding / Library) as its children. They used to be
// an in-page pill row inside the workspace iframe; the new left navigation
// (sidebar-redesign, on for everyone) suppresses that row and puts the same
// role-gated set in the sidebar, so that is where these assert.
const sidebar = (page: import('@playwright/test').Page) => page.locator('aside');
const hiringFrame = (page: import('@playwright/test').Page) =>
  page.frameLocator('iframe[title="Hiring"]');

test.describe('navigation for hiring lead', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'jordan.taylor@dali.dartmouth.edu' });
  });

  test('sidebar shows Hiring and every tool the lead may reach', async ({ page }) => {
    await page.goto('/hiring');
    const nav = sidebar(page);
    await expect(nav.getByRole('button', { name: 'Hiring' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Reviews' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Domain' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Cycles' })).toBeVisible();
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

  test('sidebar shows Domain but not Cycles', async ({ page }) => {
    await page.goto('/hiring');
    const nav = sidebar(page);
    await expect(nav.getByRole('button', { name: 'Reviews' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Domain' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Cycles' })).toHaveCount(0);
  });
});

test.describe('navigation for reviewer', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'reviewer1@dali.dartmouth.edu' });
  });

  test('sidebar shows Reviews but neither Domain nor Cycles', async ({ page }) => {
    await page.goto('/hiring');
    const nav = sidebar(page);
    await expect(nav.getByRole('button', { name: 'Reviews' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Domain' })).toHaveCount(0);
    await expect(nav.getByRole('button', { name: 'Cycles' })).toHaveCount(0);
  });
});
