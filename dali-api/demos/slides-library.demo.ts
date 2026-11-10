import { expect, setFeatureFlag, test } from './lib/demo';

test('Save a slide to the library and add a poll', async ({ page, stage, loginAs }) => {
  await setFeatureFlag('drive-slides', true);
  await setFeatureFlag('slides-collab', true);
  await setFeatureFlag('slides-live', true);
  await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });

  const created = await page.request.post('/api/lab-documents', { data: { title: 'Kickoff deck', kind: 'Slides' } });
  expect(created.ok(), await created.text()).toBe(true);
  const { id } = (await created.json()) as { id: string };

  await expect(async () => {
    await page.goto(`/slides/${id}`);
    await expect(page.getByRole('navigation', { name: 'Slides' })).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 30_000 });

  await stage.click(page.getByRole('button', { name: 'New slide' }).first());
  await stage.click(page.getByRole('button', { name: 'Title' }).first());
  await page.waitForTimeout(800);

  await stage.click(page.getByRole('button', { name: 'Insert' }));
  await stage.click(page.getByRole('menuitem', { name: 'Poll' }));
  await expect(page.locator('[data-kind="poll"]').first()).toBeVisible({ timeout: 10_000 });
  await stage.pause(1000);

  await page.getByRole('navigation', { name: 'Slides' }).getByRole('listitem').first().click({ button: 'right' });
  await stage.click(page.getByRole('menuitem', { name: 'Save slide to library' }));
  await stage.click(page.getByRole('button', { name: 'Save', exact: true }));
  await page.waitForTimeout(800);

  await stage.click(page.getByRole('button', { name: 'New slide' }).first());
  await stage.click(page.getByRole('radio', { name: 'Library' }));
  await stage.pause(1200);
});
