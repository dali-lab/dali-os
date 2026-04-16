import { test, expect } from './fixtures';

test('unauthenticated user is redirected to login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});

test('admin can log in and reach reviewer page', async ({ page, loginAs }) => {
  await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });
  await page.goto('/reviewer');
  await expect(page).toHaveURL(/\/reviewer/);
  await expect(page.locator('body')).toContainText('admin@dali.dartmouth.edu');
});

test('domain lead can access domain-lead page', async ({ page, loginAs }) => {
  await loginAs({ daliEmail: 'eng.lead@dali.dartmouth.edu' });
  await page.goto('/domain-lead');
  await expect(page).toHaveURL(/\/domain-lead/);
  await expect(page.locator('body')).toContainText('Mira');
});
