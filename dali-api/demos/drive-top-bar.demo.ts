import { expect, test } from './lib/demo';

test('Every Drive item has the same top bar', async ({ page, stage, loginAs }) => {
  await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });
  await page.goto('/forms/edit/form-challenge-design');
  const bar = page.getByRole('button', { name: 'More actions' });
  await expect(bar).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preview' })).toBeVisible();
  await page.waitForTimeout(1200);

  await stage.moveTo(page.getByRole('button', { name: 'Share' }));
  await page.waitForTimeout(600);

  await stage.click(bar);
  await expect(page.getByRole('menuitem', { name: 'Form settings' })).toBeVisible();
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');

  await page.goto('/documents/file-does-not-matter').catch(() => {});
  await page.goto('/drive');
  await page.waitForTimeout(800);
});
