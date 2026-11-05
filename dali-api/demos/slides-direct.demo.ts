import { expect, setFeatureFlag, test } from './lib/demo';

test('Edit slides directly with right-click menus and the format bar', async ({ page, stage, loginAs }) => {
  await setFeatureFlag('drive-slides', true);
  await setFeatureFlag('slides-collab', true);
  await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });

  const created = await page.request.post('/api/lab-documents', { data: { title: 'Direct editing deck', kind: 'Slides' } });
  expect(created.ok(), await created.text()).toBe(true);
  const { id } = (await created.json()) as { id: string };

  await expect(async () => {
    await page.goto(`/slides/${id}`);
    await expect(page.getByRole('navigation', { name: 'Slides' })).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 30_000 });

  await stage.click(page.getByRole('button', { name: 'New slide' }).first());
  await stage.click(page.getByRole('button', { name: 'Blank' }).first());
  await page.waitForTimeout(800);

  const layer = page.locator('[data-freeform-layer]');
  await expect(layer).toBeVisible({ timeout: 10_000 });
  const box = (await layer.boundingBox())!;
  const at = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });

  const empty = at(0.3, 0.3);
  await page.mouse.move(empty.x, empty.y);
  await page.mouse.click(empty.x, empty.y, { button: 'right' });
  await stage.click(page.getByRole('menuitem', { name: 'Add shape here' }));
  await stage.click(page.getByRole('menuitem', { name: 'Ellipse' }));
  await stage.pause(800);

  await expect(page.locator('[data-format-bar]')).toBeVisible();
  await stage.click(page.getByRole('button', { name: 'Muted' }));
  await stage.pause(500);

  const shape = at(0.3, 0.3);
  await page.mouse.click(shape.x, shape.y, { button: 'right' });
  await stage.click(page.getByRole('menuitem', { name: 'Arrange' }));
  await stage.click(page.getByRole('menuitem', { name: 'Send to back' }));
  await stage.pause(600);

  await page.keyboard.down('Alt');
  await page.mouse.move(shape.x, shape.y);
  await page.mouse.down();
  await page.mouse.move(shape.x + box.width * 0.35, shape.y + 40, { steps: 20 });
  await stage.pause(500);
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await stage.pause(800);

  const thumb = page.getByRole('button', { name: 'Slide 1' });
  await thumb.click({ button: 'right' });
  await stage.click(page.getByRole('menuitem', { name: 'Skip slide' }));
  await stage.pause(1000);
});
