import { expect, test } from './lib/demo';

test('connect: browse the map, filter people, and start hosting an event', async ({ page, stage, loginAs }) => {
  await loginAs({ daliEmail: 'priya.raman@dali.dartmouth.edu' });
  await page.goto('/connect');
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  await stage.pause(1500);

  await stage.type(page.getByLabel('Search people'), 'a');
  await stage.pause(800);
  await stage.click(page.getByRole('button', { name: 'Active this week' }));
  await stage.pause(1200);
  await stage.click(page.getByRole('button', { name: 'Clear', exact: true }));

  await stage.click(page.getByLabel("List what's on the map"));
  await stage.pause(1000);

  await stage.click(page.getByRole('radio', { name: /Events/ }));
  await stage.pause(1500);

  await stage.click(page.getByRole('button', { name: 'Host an event' }));
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await stage.zoomTo(dialog, 1.15);
  await stage.type(dialog.getByRole('textbox').first(), 'Alumni coffee and demos');
  await stage.click(dialog.getByRole('radio', { name: 'Online' }));
  await stage.pause(1500);
  await stage.resetZoom();
});
