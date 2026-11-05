import { expect, setFeatureFlag, test } from './lib/demo';
import { seedTaskboard } from '../e2e/helpers';

test('taskboard: plan a milestone task, pull it into the week and finish it', async ({ page, stage, loginAs }) => {
  await setFeatureFlag('education-taskboard', true);
  await seedTaskboard();
  await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });

  await expect(async () => {
    await page.goto('/education/taskboard');
    await expect(page.getByRole('radio', { name: 'Week' })).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await stage.pause(1000);

  await expect(async () => {
    await stage.click(page.getByRole('button', { name: 'Add', exact: true }));
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  const dialog = page.getByRole('dialog');
  await stage.type(dialog.getByLabel('Title'), 'Plan the demo day');
  await stage.pause(600);
  await stage.click(dialog.getByRole('button', { name: 'Create task' }));
  await expect(dialog).toBeHidden();
  await stage.pause(1000);

  await stage.click(page.getByRole('button', { name: 'Pull in for me', exact: true }).first());
  const card = page.locator('article', { hasText: 'Plan the demo day' });
  await stage.click(card.getByRole('button', { name: 'Start', exact: true }));
  await stage.click(card.getByRole('button', { name: 'Done', exact: true }));
  await stage.pause(800);

  await stage.click(page.getByRole('button', { name: 'Open done', exact: true }));
  await stage.pause(1500);
});
