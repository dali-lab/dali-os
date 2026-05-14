import { test, expect } from './fixtures';

test.describe('calendar settings persistence', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'jordan.taylor@dali.dartmouth.edu' });
  });

  test('Monday toggle persists across reloads', async ({ page }) => {
    // Render the calendar route standalone (skip workspace shell).
    await page.goto('/calendar?embed=1');
    await expect(page.getByRole('heading', { name: 'Availability' })).toBeVisible();

    // Normalize: ensure Monday is enabled before the actual test.
    if ((await page.getByLabel('Mon segment 1 start').count()) === 0) {
      await page.getByRole('button', { name: /Mon enabled/i }).click();
      await expect(page.getByLabel('Mon segment 1 start')).toBeVisible();
      await page.waitForLoadState('networkidle');
    }

    // Disable Monday.
    await page.getByRole('button', { name: /Mon enabled/i }).click();
    await expect(page.getByLabel('Mon segment 1 start')).toHaveCount(0);
    await page.waitForLoadState('networkidle');

    // Reload and assert state persists.
    await page.reload();
    await expect(page.getByLabel('Mon segment 1 start')).toHaveCount(0);

    // Toggle back on (leaves DB in enabled state for next run).
    await page.getByRole('button', { name: /Mon enabled/i }).click();
    await expect(page.getByLabel('Mon segment 1 start')).toBeVisible();
    await page.waitForLoadState('networkidle');
  });

  test('event buffer selection persists', async ({ page }) => {
    await page.goto('/calendar?embed=1');
    // Pick 45m specifically so this test doesn't collide with the 15m default
    // or the 30m value other ad-hoc clicks tend to leave behind.
    await page.getByRole('button', { name: '45m', exact: true }).click();
    await expect(page.getByText(/45-minute buffer will be added/)).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.reload();
    await expect(page.getByText(/45-minute buffer will be added/)).toBeVisible();
  });

  test('Add Google Account link is present and points at OAuth start', async ({ page }) => {
    await page.goto('/calendar?embed=1');
    const link = page.getByRole('link', { name: /Add Google Account/i });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/oauth/calendar/google/start');
    // Must break out of the workspace iframe so Google's auth page isn't blocked
    // by X-Frame-Options: DENY.
    await expect(link).toHaveAttribute('target', '_top');
  });

  test('manual block can be added and removed', async ({ page }) => {
    await page.goto('/calendar?embed=1');

    await page.getByRole('button', { name: 'Add Block', exact: true }).click();
    await page.getByPlaceholder(/Title/i).fill('Test Block');

    // Pick a start/end ~1 week out so it doesn't collide with the rendered week.
    const start = new Date(Date.now() + 7 * 86_400_000);
    const end = new Date(start.getTime() + 60 * 60_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const toLocalInput = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    await page.locator('input[name="startTimeLocal"]').fill(toLocalInput(start));
    await page.locator('input[name="endTimeLocal"]').fill(toLocalInput(end));

    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText('Test Block')).toBeVisible();

    // Remove it.
    await page.getByRole('button', { name: 'Remove Test Block' }).click();
    await expect(page.getByText('Test Block')).toHaveCount(0);
  });
});
