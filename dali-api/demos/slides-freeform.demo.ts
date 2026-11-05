import { expect, setFeatureFlag, test } from './lib/demo';

test('Place and arrange items anywhere on a slide', async ({ page, stage, loginAs }) => {
  await setFeatureFlag('drive-slides', true);
  await setFeatureFlag('slides-collab', true);
  await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });

  const created = await page.request.post('/api/lab-documents', { data: { title: 'Freeform deck', kind: 'Slides' } });
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

  await stage.click(page.getByRole('button', { name: 'Text box' }));
  const text = at(0.3, 0.3);
  await page.mouse.click(text.x, text.y);
  await page.keyboard.type('Launch plan', { delay: 70 });
  await page.keyboard.press('Escape');

  await stage.click(page.getByRole('button', { name: 'Shape' }));
  await stage.click(page.getByRole('menuitem', { name: 'Ellipse' }));
  const shape = at(0.7, 0.55);
  await page.mouse.click(shape.x, shape.y);
  await page.waitForTimeout(500);

  const from = at(0.7, 0.55);
  const to = at(0.62, 0.62);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 20 });
  await stage.pause(600);
  await page.mouse.up();

  await stage.click(page.getByRole('button', { name: 'Align center' }).first());
  await stage.pause(800);
  await stage.click(page.getByRole('button', { name: 'Undo' }));
  await stage.pause(1000);
});
