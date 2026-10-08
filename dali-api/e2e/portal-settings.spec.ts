import { test, expect } from './fixtures';

// Applicant settings live behind the account menu at the foot of the portal
// rail: editable preferred name, pronouns, phone.
test('applicant edits settings via the account menu', async ({ page, loginAs }) => {
  await loginAs({ netId: 'f007ke1' });
  await page.goto('/portal');

  await page.getByRole('button', { name: /account menu/i }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/portal\/settings/);

  await page.getByLabel('Pronouns').fill('they/them');
  // The page has no "Saved" state to wait on, and the button is only disabled
  // for the beat the submit is in flight, so anchor on the action's response:
  // reloading before it lands aborts the save and reads back the old value.
  const saved = page.waitForResponse(
    r => r.request().method() === 'POST' && r.url().includes('/portal/settings'),
  );
  await page.getByRole('button', { name: 'Save profile' }).click();
  expect((await saved).ok()).toBe(true);

  await page.reload();
  await expect(page.getByLabel('Pronouns')).toHaveValue('they/them');
});
