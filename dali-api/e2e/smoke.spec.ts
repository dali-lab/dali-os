import { test, expect } from './fixtures';

test('unauthenticated user is redirected to login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});

test('admin can log in and reach reviewer page', async ({ page, loginAs }) => {
  await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });
  await page.goto('/hiring/reviewer');
  await expect(page).toHaveURL(/\/hiring\/reviewer/);
  // Sidebar footer shows the user's first name; assert it inside <aside>
  // to avoid matching the "Admin" copy that appears elsewhere on the page.
  await expect(page.locator('aside').first()).toContainText('Admin');
});

test('domain lead can access domain-lead page', async ({ page, loginAs }) => {
  await loginAs({ daliEmail: 'eng.lead@dali.dartmouth.edu' });
  await page.goto('/hiring/domain-lead');
  await expect(page).toHaveURL(/\/hiring\/domain-lead/);
  // Section content renders inside the workspace iframe.
  const frame = page.frameLocator('iframe[title="Domain"]');
  await expect(frame.locator('body')).toContainText('Mira');
});
