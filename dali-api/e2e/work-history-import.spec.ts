import { test, expect } from './fixtures';
import { deleteWorkExperiences, enableFeatureFlag } from './helpers';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The CSV path only: CI has no S3 or AI provider, so PDF upload is covered by
// the route and modal unit tests.

const EMAIL = 'jordan.taylor@dali.dartmouth.edu';
const COMPANIES = ['E2E Import Alpha', 'E2E Import Beta', 'E2E Import Gamma'];

test.describe('Work history import', () => {
  test.beforeEach(async ({ loginAs }) => {
    await deleteWorkExperiences(EMAIL, COMPANIES);
    await enableFeatureFlag('work-history-import');
    await loginAs({ daliEmail: EMAIL });
  });

  test.afterEach(async () => {
    await deleteWorkExperiences(EMAIL, COMPANIES);
  });

  test('imports the checked jobs from Positions.csv', async ({ page }) => {
    await page.goto('/profile');
    await page.waitForLoadState('networkidle');

    // Flag rows are cached for up to 15s; reload until the button shows.
    const importButton = page.getByRole('button', { name: 'Import' });
    await expect(async () => {
      await page.reload();
      await expect(importButton).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });

    await importButton.click();
    await page
      .locator('input[type="file"]')
      .setInputFiles(path.join(__dirname, 'fixtures', 'Positions.csv'));

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Staff Engineer')).toBeVisible();
    await dialog.getByRole('checkbox', { name: 'Research Assistant at E2E Import Gamma' }).uncheck({ force: true });
    await dialog.getByRole('button', { name: 'Add 2 jobs' }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText('E2E Import Alpha')).toBeVisible();
    await expect(page.getByText('E2E Import Beta')).toBeVisible();
    await expect(page.getByText('E2E Import Gamma')).toHaveCount(0);
  });
});
