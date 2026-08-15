import { test, expect } from './fixtures';

// Hiring navigation after the sidebar reduction: the sidebar carries a single
// childless "Hiring" entry landing on the /hiring hub, and the role-gated
// tools (Reviews / Applications / Domain / Cycles / Analytics / Library) are
// an in-page pill row rendered inside the workspace iframe.
const hiringFrame = (page: import('@playwright/test').Page) =>
  page.frameLocator('iframe[title="Hiring"]');

test.describe('navigation for hiring lead', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'jordan.taylor@dali.dartmouth.edu' });
  });

  test('sidebar shows Hiring; hub pills expose every tool', async ({ page }) => {
    await page.goto('/hiring');
    await expect(
      page.locator('aside').getByRole('button', { name: 'Hiring' }),
    ).toBeVisible();
    const frame = hiringFrame(page);
    await expect(frame.getByRole('link', { name: 'Reviews' })).toBeVisible();
    await expect(frame.getByRole('link', { name: 'Domain' })).toBeVisible();
    await expect(frame.getByRole('link', { name: 'Cycles' })).toBeVisible();
    // Library was folded into the Hiring drive (/drive); no pill anymore.
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

  test('hub pills show Domain but not Cycles', async ({ page }) => {
    await page.goto('/hiring');
    const frame = hiringFrame(page);
    await expect(frame.getByRole('link', { name: 'Reviews' })).toBeVisible();
    await expect(frame.getByRole('link', { name: 'Domain' })).toBeVisible();
    await expect(frame.getByRole('link', { name: 'Cycles' })).not.toBeVisible();
  });
});

test.describe('navigation for reviewer', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'reviewer1@dali.dartmouth.edu' });
  });

  test('hub pills show Reviews only', async ({ page }) => {
    await page.goto('/hiring');
    const frame = hiringFrame(page);
    await expect(frame.getByRole('link', { name: 'Reviews' })).toBeVisible();
    await expect(frame.getByRole('link', { name: 'Domain' })).not.toBeVisible();
    await expect(frame.getByRole('link', { name: 'Cycles' })).not.toBeVisible();
  });
});
