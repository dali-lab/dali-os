import { test, expect } from './fixtures';
import { resetTaskboard, seedTaskboard, setFeatureFlag } from './helpers';

// Seeded users: admin@dali.dartmouth.edu is Admin (Core); noor.haddad@dali.dartmouth.edu is a plain member.

async function openAdd(page: import('@playwright/test').Page, tab?: string) {
  await expect(async () => {
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  if (tab) await page.getByRole('dialog').getByRole('radio', { name: tab }).click();
}

test.describe('education taskboard', () => {
  let periodId = '';

  test.beforeEach(async () => {
    await setFeatureFlag('education-taskboard', true);
    periodId = await seedTaskboard();
  });

  test.afterAll(async () => {
    await resetTaskboard();
    await setFeatureFlag('education-taskboard', false);
  });

  test('members who are not Core are sent back to Education', async ({ page, loginAs }) => {
    await loginAs({ daliEmail: 'noor.haddad@dali.dartmouth.edu' });
    await page.goto('/education/taskboard');
    await expect(page).toHaveURL(/\/education$/);
    await expect(page.getByRole('button', { name: 'Taskboard' })).toHaveCount(0);
  });

  test('Core plans a task, pulls it into the week and finishes it', async ({ page, loginAs }) => {
    await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });
    await expect(async () => {
      await page.goto(`/education/taskboard?period=${periodId}&week=3`);
      await expect(page.getByRole('radio', { name: 'Week' })).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 30_000 });

    await openAdd(page);
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Title').fill('E2E plan the demo');
    await dialog.getByRole('button', { name: 'Create task' }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByText('E2E plan the demo')).toBeVisible();
    await page.getByRole('button', { name: 'Pull in for me', exact: true }).first().click();

    const card = page.locator('article', { hasText: 'E2E plan the demo' });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Start', exact: true }).click();
    await card.getByRole('button', { name: 'Done', exact: true }).click();

    await page.getByRole('button', { name: 'Open done', exact: true }).click();
    await expect(page.getByText('E2E plan the demo')).toBeVisible();
    await expect(page.getByText("Only this week's done tasks show here.")).toBeVisible();
  });

  test('Core creates a milestone and sees it on the term view', async ({ page, loginAs }) => {
    await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });
    await expect(async () => {
      await page.goto(`/education/taskboard?zoom=term&period=${periodId}&week=3`);
      await expect(page.getByText('E2E milestone')).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 30_000 });

    await openAdd(page, 'Milestone');
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('E2E second milestone');
    await dialog.getByRole('button', { name: 'Create milestone' }).click();

    await expect(page.getByRole('dialog').getByText('E2E second milestone')).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).first().click();
    await expect(page.getByText('E2E second milestone')).toBeVisible();
  });
});
