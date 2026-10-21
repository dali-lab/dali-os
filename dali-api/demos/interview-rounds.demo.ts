import { expect, test } from './lib/demo';

test('hiring: add a second interview round to an open cycle', async ({ page, stage, loginAs }) => {
  await loginAs({ daliEmail: 'jordan.taylor@dali.dartmouth.edu' });

  await page.goto('/hiring/lead/cycle/cycle-fall-2026?tab=setup#timeline');
  const add = page.getByRole('button', { name: 'Add', exact: true });
  await expect(add).toBeVisible();
  await stage.zoomTo(add, 1.3);
  await stage.pause(600);
  await stage.click(add);
  await stage.click(page.getByRole('menuitem', { name: 'Interview round' }));
  await stage.pause(800);
  await stage.resetZoom();

  await stage.click(page.getByRole('button', { name: 'Save', exact: true }));
  const roundTab = page.getByRole('link', { name: /Interviews 2/ }).or(page.getByRole('tab', { name: /Interviews 2/ }));
  await expect(roundTab.first()).toBeVisible();
  await stage.click(roundTab.first());

  await expect(page.getByText('Interview schedule').first()).toBeVisible();
  await stage.pause(1500);
});
