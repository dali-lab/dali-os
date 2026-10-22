import { expect, setFeatureFlag, test } from './lib/demo';

test('community: switch to the Community section and browse its pages', async ({ page, stage, loginAs }) => {
  await setFeatureFlag('community', true);
  await loginAs({ daliEmail: 'jordan.taylor@dali.dartmouth.edu' });

  // Flag rows are cached for 15s server-side.
  await expect(async () => {
    await page.goto('/projects');
    await page.getByRole('button', { name: /Switch section/ }).click();
    await expect(page.getByRole('option', { name: 'Community' })).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await stage.pause(800);

  await stage.click(page.getByRole('option', { name: 'Community' }));
  await expect(page.getByRole('heading', { name: 'Connect' })).toBeVisible();
  await stage.pause(1500);

  for (const name of ['Opportunities', 'Gallery']) {
    await stage.click(page.getByRole('button', { name, exact: true }));
    await expect(page.getByRole('heading', { name })).toBeVisible();
    await stage.pause(1000);
  }

  await stage.click(page.getByRole('button', { name: 'Blogs', exact: true }));
  await expect(page.getByRole('heading', { name: 'Everything DALI' })).toBeVisible();
  await stage.pause(1800);
});
