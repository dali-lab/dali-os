import { expect, setFeatureFlag, test } from './lib/demo';

test('journeys: preview a draft as a learner with every module open', async ({ page, stage, loginAs }) => {
  await setFeatureFlag('onboarding-journeys', true);
  await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });

  // Flag rows are cached for 15s server-side.
  await expect(async () => {
    await page.goto('/journeys/fullstack/demo-journey-web-foundations/edit');
    await expect(page.getByRole('button', { name: 'Preview' })).toBeEnabled({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await stage.pause(1000);

  await stage.click(page.getByRole('button', { name: 'Preview' }));
  await expect(page.getByText('Learner preview.')).toBeVisible();
  await stage.zoomTo(page.getByRole('status').filter({ hasText: 'Learner preview.' }), 1.4);
  await stage.pause(1200);
  await stage.resetZoom();

  await stage.click(page.getByRole('button', { name: /^Ship your first ticket,/ }));
  await stage.pause(1000);
  await stage.click(page.getByRole('link', { name: 'Start module' }));
  await expect(page.getByRole('heading', { name: 'Ship your first ticket' })).toBeVisible();
  await stage.pause(1800);

  await stage.click(page.getByRole('link', { name: 'Back to editor' }));
  await expect(page.getByRole('button', { name: 'Preview' })).toBeVisible();
  await stage.pause(1000);
});
