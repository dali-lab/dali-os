import { test, expect } from './fixtures';
import { deleteWorkExperiences, setFeatureFlag } from './helpers';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The CSV path only: CI has no S3 or AI provider, so PDF upload is covered by
// the route and modal unit tests.

// A seeded alum whose profile already lists Figma, so the import sees a duplicate.
const EMAIL = 'priya.raman@dali.dartmouth.edu';
const COMPANIES = ['E2E Import Alpha', 'E2E Import Beta', 'E2E Import Gamma'];

test.describe('Work history import', () => {
  test.beforeEach(async ({ page, baseURL, loginAs }) => {
    await deleteWorkExperiences(EMAIL, COMPANIES);
    await setFeatureFlag('work-history-import', true);
    // Tabless (the app default) renders the profile in the page itself, not a workspace iframe.
    await page.context().addCookies([{ name: 'dali_tabless', value: '1', url: baseURL! }]);
    await loginAs({ daliEmail: EMAIL });
  });

  test.afterEach(async () => {
    await deleteWorkExperiences(EMAIL, COMPANIES);
    await setFeatureFlag('work-history-import', false);
  });

  test('imports the checked jobs from Positions.csv', async ({ page }) => {
    await page.goto('/profile');

    // Flag rows are cached for up to 15s; reload until the button shows.
    const importButton = page.getByRole('button', { name: 'Import' });
    await expect(async () => {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(importButton).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });

    await importButton.click();
    const dialog = page.getByRole('dialog');
    await dialog
      .locator('input[type="file"]')
      .setInputFiles(path.join(__dirname, 'fixtures', 'Positions.csv'));

    await expect(dialog.getByText('Staff Engineer')).toBeVisible();
    await expect(dialog.getByRole('checkbox', { name: 'Product Designer at Figma' })).not.toBeChecked();
    await expect(dialog.getByText('Already on your profile')).toBeVisible();

    await dialog.getByRole('checkbox', { name: 'Research Assistant at E2E Import Gamma' }).uncheck({ force: true });
    await dialog.getByRole('button', { name: 'Add 2 jobs' }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText('E2E Import Alpha')).toBeVisible();
    await expect(page.getByText('E2E Import Beta')).toBeVisible();
    await expect(page.getByText('E2E Import Gamma')).toHaveCount(0);
  });
});
