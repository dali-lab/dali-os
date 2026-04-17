import { test, expect } from './fixtures';

test.describe('hiring lead workflow', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'jordan.taylor@dali.dartmouth.edu' });
  });

  test('cycles list shows all cycles with status badges', async ({ page }) => {
    await page.goto('/hiring-lead-admin');
    await expect(page.getByRole('heading', { name: 'Hiring Cycles' })).toBeVisible();
    await expect(page.getByRole('button', { name: /New Cycle/ })).toBeVisible();
    await expect(page.getByText('Fall 2026').first()).toBeVisible();
    await expect(page.getByText('Under Review').first()).toBeVisible();
  });

  test('can navigate to cycle detail', async ({ page }) => {
    await page.goto('/hiring-lead-admin');
    await page.getByRole('link', { name: /Fall 2026/ }).click();
    await expect(page).toHaveURL(/\/hiring-lead-admin\/cycle\/.+/);
  });

  test('cycle detail shows management tabs', async ({ page }) => {
    await page.goto('/hiring-lead-admin');
    await page.getByRole('link', { name: /Fall 2026/ }).click();

    await expect(page.getByRole('button', { name: 'Cycle Setup' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Interview Setup' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reviewer Roster' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Interview Dashboard' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Decisions' })).toBeVisible();
  });

  test('cycle setup tab shows domains', async ({ page }) => {
    await page.goto('/hiring-lead-admin');
    await page.getByRole('link', { name: /Fall 2026/ }).click();

    await expect(page.getByText('Engineering').first()).toBeVisible();
    await expect(page.getByText('Design').first()).toBeVisible();
    await expect(page.getByText('Product').first()).toBeVisible();
  });

  test('interview setup tab shows config fields', async ({ page }) => {
    await page.goto('/hiring-lead-admin');
    await page.getByRole('link', { name: /Fall 2026/ }).click();
    await page.getByRole('button', { name: 'Interview Setup' }).click();

    await expect(page.getByText('Slot Duration')).toBeVisible();
    await expect(page.getByText('Buffer Between Interviews')).toBeVisible();
  });

  test('decisions tab shows finalized decisions', async ({ page }) => {
    await page.goto('/hiring-lead-admin');
    await page.getByRole('link', { name: /Fall 2026/ }).click();
    await page.getByRole('button', { name: 'Decisions' }).click();

    await expect(page.getByText('Alice Johnson').first()).toBeVisible();
  });
});
