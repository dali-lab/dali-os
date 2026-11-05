import { expect, setFeatureFlag, test } from './lib/demo';

test('Pick layouts from a gallery, set a background, add sections and a transition', async ({ page, stage, loginAs }) => {
  await setFeatureFlag('drive-slides', true);
  await setFeatureFlag('slides-collab', true);
  await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });

  const created = await page.request.post('/api/lab-documents', { data: { title: 'Polish deck', kind: 'Slides' } });
  expect(created.ok(), await created.text()).toBe(true);
  const { id } = (await created.json()) as { id: string };

  await expect(async () => {
    await page.goto(`/slides/${id}`);
    await expect(page.getByRole('navigation', { name: 'Slides' })).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 30_000 });

  await stage.click(page.getByRole('button', { name: 'Choose a layout' }).first());
  await stage.click(page.locator('[data-layout-thumb="title"]').first());
  await stage.click(page.getByRole('button', { name: 'New slide' }).first());
  await page.waitForTimeout(500);

  await stage.click(page.getByRole('button', { name: 'Accent' }));
  await stage.pause(600);
  await stage.click(page.getByRole('radio', { name: 'Push' }));
  await stage.click(page.getByRole('button', { name: 'Preview' }));
  await stage.pause(1500);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Slide 2' }).click({ button: 'right' });
  await stage.click(page.getByRole('menuitem', { name: 'Add section here' }));
  await stage.type(page.getByLabel('Section name'), 'Wrap up');
  await page.keyboard.press('Enter');
  await stage.pause(800);

  await stage.click(page.getByRole('button', { name: 'Grid' }));
  await stage.pause(1500);
});
