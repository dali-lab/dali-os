import { expect, setFeatureFlag, test } from './lib/demo';

test('Add charts, tables, icons and video to a slide, then find and replace', async ({ page, stage, loginAs }) => {
  await setFeatureFlag('drive-slides', true);
  await setFeatureFlag('slides-collab', true);
  await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });

  const created = await page.request.post('/api/lab-documents', { data: { title: 'Content deck', kind: 'Slides' } });
  expect(created.ok(), await created.text()).toBe(true);
  const { id } = (await created.json()) as { id: string };

  await expect(async () => {
    await page.goto(`/slides/${id}`);
    await expect(page.getByRole('navigation', { name: 'Slides' })).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 30_000 });

  await stage.click(page.getByRole('button', { name: 'New slide' }).first());
  await stage.click(page.getByRole('button', { name: 'Blank' }).first());
  await expect(page.locator('[data-freeform-layer]')).toBeVisible({ timeout: 10_000 });

  await stage.click(page.getByRole('button', { name: 'Insert' }));
  await stage.click(page.getByRole('menuitem', { name: 'Bar chart' }));
  await stage.pause(800);
  await stage.click(page.getByRole('radio', { name: 'Line' }));
  await stage.pause(800);

  await stage.click(page.getByRole('button', { name: 'Insert' }));
  await stage.click(page.getByRole('menuitem', { name: 'Icon' }));
  await stage.type(page.getByLabel('Search icons'), 'rocket');
  await stage.click(page.getByRole('option', { name: 'rocket' }));
  await stage.pause(800);

  await page.keyboard.press('Meta+f');
  await stage.type(page.getByLabel('Find'), 'Series');
  await stage.pause(800);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+/');
  await stage.pause(1200);
});
