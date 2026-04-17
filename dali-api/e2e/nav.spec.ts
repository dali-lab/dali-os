import { test, expect } from './fixtures';

test.describe('navigation for hiring lead', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'jordan.taylor@dali.dartmouth.edu' });
  });

  test('shows hiring lead and domain lead nav tabs', async ({ page }) => {
    await page.goto('/reviewer');
    const nav = page.locator('nav');
    await expect(nav.getByRole('link', { name: 'Reviewer Dashboard' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Domain Lead' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Challenges' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Rubrics' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Cycles' })).toBeVisible();
  });

  test('can navigate to cycles page', async ({ page }) => {
    await page.goto('/hiring-lead-admin');
    await expect(page).toHaveURL(/\/hiring-lead-admin/);
    await expect(page.getByRole('heading', { name: 'Hiring Cycles' })).toBeVisible();
  });
});

test.describe('navigation for domain lead', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'eng.lead@dali.dartmouth.edu' });
  });

  test('shows domain lead and interviewer tabs but not cycles', async ({ page }) => {
    await page.goto('/reviewer');
    const nav = page.locator('nav');
    await expect(nav.getByRole('link', { name: 'Reviewer Dashboard' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Domain Lead' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Interviewer' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Cycles' })).not.toBeVisible();
  });
});

test.describe('navigation for reviewer', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'reviewer1@dali.dartmouth.edu' });
  });

  test('shows reviewer and interviewer tabs only', async ({ page }) => {
    await page.goto('/reviewer');
    const nav = page.locator('nav');
    await expect(nav.getByRole('link', { name: 'Reviewer Dashboard' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Interviewer' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Domain Lead' })).not.toBeVisible();
    await expect(nav.getByRole('link', { name: 'Cycles' })).not.toBeVisible();
  });
});
