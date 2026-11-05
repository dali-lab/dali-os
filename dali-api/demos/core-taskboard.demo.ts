import { expect, setFeatureFlag, test } from './lib/demo';

test('Core taskboard and term milestones', async ({ page, stage, loginAs }) => {
  await setFeatureFlag('core-taskboard', true);
  await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });
  await expect(async () => {
    await page.goto('/core');
    await expect(page.getByRole('heading', { name: 'Taskboard' })).toBeVisible({ timeout: 2000 });
  }).toPass();
  await page.waitForTimeout(1200);

  await stage.click(page.getByRole('link', { name: 'Milestones' }).first());
  await expect(page.getByRole('heading', { name: 'Milestones', level: 1 })).toBeVisible();
  await stage.click(page.getByRole('button', { name: 'Week 2' }));

  await stage.click(page.getByRole('button', { name: 'Add a milestone' }));
  await stage.type(page.getByLabel('New milestone'), 'Applications open');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Title').first()).toHaveValue('Applications open');

  await stage.click(page.getByRole('button', { name: 'Add to plan' }));
  await stage.type(page.getByLabel('New plan item'), 'Open hiring');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Title').nth(1)).toHaveValue('Open hiring');
  await page.waitForTimeout(1500);
});
