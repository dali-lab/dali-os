import { test, expect } from './fixtures';

// Applicant settings live behind the profile-chip menu (same shape as the
// partner portal): editable preferred name, pronouns, phone.
test('applicant edits settings via the profile menu', async ({ page, loginAs }) => {
  await loginAs({ netId: 'f007ke1' });
  await page.goto('/portal');

  await page.locator('button[title="Account"]').click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/portal\/settings/);

  await page.getByLabel('Pronouns').fill('they/them');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('button', { name: 'Save profile' })).toBeEnabled();

  await page.reload();
  await expect(page.getByLabel('Pronouns')).toHaveValue('they/them');
});
