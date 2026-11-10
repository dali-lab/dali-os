import { test, expect } from './fixtures';

// Hiring navigation: the sidebar's Hiring entry lands on /hiring (My work) and
// carries the role-gated tools (My work / Applications / Domain /
// Cycles / Waitlists / Onboarding / Library) as its children, so that is where
// these assert.
const sidebar = (page: import('@playwright/test').Page) => page.locator('aside');

test.describe('navigation for hiring lead', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'jordan.taylor@dali.dartmouth.edu' });
  });

  test('sidebar shows Hiring and every tool the lead may reach', async ({ page }) => {
    await page.goto('/hiring');
    const nav = sidebar(page);
    await expect(nav.getByRole('button', { name: 'Hiring' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'My work' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Domain' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Cycles' })).toBeVisible();
  });

  test('can navigate to cycles page', async ({ page }) => {
    await page.goto('/hiring/lead');
    await expect(page).toHaveURL(/\/hiring\/lead/);
    await expect(page.getByRole('heading', { name: 'Cycles', exact: true })).toBeVisible();
  });
});

test.describe('navigation for domain lead', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'eng.lead@dali.dartmouth.edu' });
  });

  test('sidebar shows Domain but not Cycles', async ({ page }) => {
    await page.goto('/hiring');
    const nav = sidebar(page);
    await expect(nav.getByRole('button', { name: 'My work' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Domain' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Cycles' })).toHaveCount(0);
  });
});

test.describe('navigation for reviewer', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'reviewer1@dali.dartmouth.edu' });
  });

  test('sidebar shows My work but neither Domain nor Cycles', async ({ page }) => {
    await page.goto('/hiring');
    const nav = sidebar(page);
    await expect(nav.getByRole('button', { name: 'My work' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Domain' })).toHaveCount(0);
    await expect(nav.getByRole('button', { name: 'Cycles' })).toHaveCount(0);
  });
});
