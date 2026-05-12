import { test, expect } from './fixtures';

test.describe('calendar settings persistence', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'jordan.taylor@dali.dartmouth.edu' });
  });

  test('Monday toggle persists across reloads', async ({ page }) => {
    // Render the calendar route standalone (skip workspace shell).
    await page.goto('/calendar?embed=1');
    await expect(page.getByRole('heading', { name: 'Availability' })).toBeVisible();

    const mondayToggle = page.getByRole('button', { name: /Mon enabled/i });
    await expect(mondayToggle).toBeVisible();

    // Monday is enabled by default → show times.
    await expect(page.getByLabel('Mon start time')).toBeVisible();

    // Disable Monday.
    await mondayToggle.click();
    // The times disappear; "Unavailable" label shows.
    await expect(page.getByLabel('Mon start time')).toHaveCount(0);

    // Reload and assert state persists.
    await page.reload();
    await expect(page.getByLabel('Mon start time')).toHaveCount(0);

    // Toggle back on.
    await page.getByRole('button', { name: /Mon enabled/i }).click();
    await expect(page.getByLabel('Mon start time')).toBeVisible();
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

  test('manual block can be added and removed', async ({ page }) => {
    await page.goto('/calendar?embed=1');

    await page.getByRole('button', { name: /Add Block/i }).click();
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
