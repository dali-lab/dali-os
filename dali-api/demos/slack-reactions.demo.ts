import { expect, test } from './lib/demo';

test('feature requests, mentions and Slack-style reactions', async ({ page, stage, loginAs }) => {
  await loginAs({ daliEmail: 'jordan.taylor@dali.dartmouth.edu' });
  await expect(async () => {
    await page.goto('/feedback');
    await expect(page.getByRole('button', { name: 'New request' })).toBeVisible({ timeout: 2000 });
  }).toPass();

  await stage.click(page.getByRole('button', { name: 'New request' }));
  await stage.type(page.getByRole('textbox', { name: 'Feedback' }), 'Let us filter requests by page');
  await stage.click(page.getByRole('button', { name: 'Post', exact: true }));
  await expect(page.getByText('Let us filter requests by page')).toBeVisible();

  const add = page.getByRole('button', { name: 'Add reaction' }).first();
  await stage.click(add);
  await stage.type(page.getByLabel('Search emoji'), 'unicorn');
  await stage.click(page.getByRole('button', { name: 'Unicorn' }));
  const chip = page.getByRole('button', { name: '🦄 1' });
  await expect(chip).toBeVisible();
  await stage.moveTo(chip, 800);
  await page.waitForTimeout(1200);

  const comment = page.getByLabel('Add a comment').first();
  await stage.type(comment, 'cc @pri');
  await expect(page.getByText('@priyaraman')).toBeVisible();
  await comment.press('Enter');
  await comment.press('Enter');
  await expect(page.locator('span.text-os-accent', { hasText: '@priyaraman' })).toBeVisible();
  await page.waitForTimeout(800);
});
