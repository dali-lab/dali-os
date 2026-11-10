import { expect, setFeatureFlag, test } from './lib/demo';

test('Edit a slide deck together', async ({ page, stage, loginAs }) => {
  await setFeatureFlag('drive-slides', true);
  await setFeatureFlag('slides-collab', true);
  await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });

  const created = await page.request.post('/api/lab-documents', { data: { title: 'Demo day deck', kind: 'Slides' } });
  expect(created.ok(), await created.text()).toBe(true);
  const { id } = (await created.json()) as { id: string };

  await expect(async () => {
    await page.goto(`/slides/${id}`);
    await expect(page.getByRole('navigation', { name: 'Slides' })).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 30_000 });

  await stage.click(page.getByRole('button', { name: 'New slide' }).first());
  await stage.click(page.getByRole('button', { name: 'Title' }).first());
  await page.waitForTimeout(800);

  const title = page.locator('[data-slot="title"] .bn-editor').first();
  await stage.click(title);
  await page.keyboard.type('Demo day', { delay: 70 });
  await page.waitForTimeout(600);

  await stage.click(page.getByRole('radio', { name: 'Deck' }));
  await stage.click(page.getByRole('button', { name: 'DALI Light' }));
  await page.waitForTimeout(1000);

  await stage.click(page.getByRole('button', { name: 'Undo' }));
  await page.waitForTimeout(1200);
});
