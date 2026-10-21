import { expect, setFeatureFlag, test } from './lib/demo';

test('release notes: draft an entry, publish it, read it', async ({ page, stage, loginAs }) => {
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
  await stage.click(dialog.getByRole('combobox', { name: 'Area' }));
  await stage.click(page.getByRole('option', { name: 'Projects' }));
  await stage.click(dialog.getByText('Highlight', { exact: true }));
  await stage.pause(600);
  await stage.resetZoom();

  await stage.click(dialog.getByRole('button', { name: 'Save and publish' }));
  await expect(dialog).toBeHidden();
  await stage.pause(800);

  await page.goto('/release-notes');
  const entry = page.getByText('Release notes are here').first();
  await expect(entry).toBeVisible();
  await stage.pause(800);
  await stage.zoomTo(entry, 1.4);
  await stage.pause(1800);
});
