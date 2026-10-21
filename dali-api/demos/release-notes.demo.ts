import { expect, setFeatureFlag, test } from './lib/demo';

test('release notes: draft an entry and read it', async ({ page, stage, loginAs }) => {
  await setFeatureFlag('release-notes', true);
  await loginAs({ daliEmail: 'jordan.taylor@dali.dartmouth.edu' });

  // Flag rows are cached for 15s server-side.
  await expect(async () => {
    await page.goto('/core/communications/release-notes');
    await expect(page.getByRole('heading', { name: 'Release notes' })).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await stage.pause(1200);

  await stage.click(page.getByRole('button', { name: 'New draft' }));
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await stage.pause(500);

  await stage.zoomTo(dialog, 1.3);
  await stage.type(dialog.getByLabel('Title'), 'Release notes are here');
  await stage.type(dialog.getByLabel('Summary'), 'See what shipped in DALI OS, with short demos.');
  await stage.pause(800);
  await stage.resetZoom();

  await stage.click(dialog.getByRole('button', { name: /close/i }).first());
  await stage.pause(800);

  await page.goto('/release-notes');
  await expect(page.getByRole('heading', { name: /release notes/i }).first()).toBeVisible();
  await stage.pause(2000);
});
