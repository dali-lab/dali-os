import { test, expect } from './fixtures';

// Mon–Fri 9–5 InPerson, the same shape the UI's "turn working hours on" button
// seeds. Materialized directly so each run starts from a known state instead of
// inheriting whatever the previous run left behind.
const SEEDED_WEEK = JSON.stringify(
  Array.from({ length: 7 }, (_, dow) => ({
    dayOfWeek: dow,
    segments:
      dow >= 1 && dow <= 5
        ? [{ startMinute: 9 * 60, endMinute: 17 * 60, location: 'InPerson' }]
        : [],
  })),
);

test.describe('calendar settings persistence', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'jordan.taylor@dali.dartmouth.edu' });
  });

  test('Monday toggle persists across reloads', async ({ page }) => {
    // Establish a deterministic starting state: working hours on, Mon–Fri
    // enabled. This test mutates persistent DB rows, and an interrupted prior
    // run can leave Monday disabled or working hours off — seeding up front
    // makes it independent of inherited state rather than relying on a cleanup
    // step that only runs if the test reaches the end.
    const seedRes = await page.request.post('/calendar', {
      form: { intent: 'seed-working-hours', days: SEEDED_WEEK },
    });
    expect(seedRes.ok()).toBeTruthy();

    // Render the calendar route standalone (skip workspace shell).
    await page.goto('/calendar?embed=1');
    // The view switcher, not the rail's heading: the os shell names the page
    // once (its title) and lets the switcher name the view, so the old
    // "Availability" h1 only exists in the brand shell.
    await expect(page.getByRole('tab', { name: 'My Availability' })).toBeVisible();

    // The seed turned working hours on, so Monday's segment editor is present.
    await expect(page.getByLabel('Mon segment 1 start')).toBeVisible();

    // Disable Monday via its per-day toggle (only present while the master
    // switch is on).
    await page.getByRole('button', { name: /Mon enabled/i }).click();
    await expect(page.getByLabel('Mon segment 1 start')).toHaveCount(0);
    await page.waitForLoadState('networkidle');

    // Reload and assert the disabled state persists. The master switch stays on
    // (other days still have segments), so the editor — and Monday's toggle —
    // remain visible.
    await page.reload();
    await expect(page.getByLabel('Mon segment 1 start')).toHaveCount(0);

    // Toggle Monday back on and confirm the segment reappears.
    await page.getByRole('button', { name: /Mon enabled/i }).click();
    await expect(page.getByLabel('Mon segment 1 start')).toBeVisible();
    await page.waitForLoadState('networkidle');
  });

  test('event buffer selection persists', async ({ page }) => {
    await page.goto('/calendar?embed=1');
    // Pick 30m (the largest offered option) so this test doesn't collide with
    // the 15m default.
    const thirty = page.getByRole('button', { name: '30m', exact: true });
    await thirty.click();
    await expect(thirty).toHaveAttribute('aria-pressed', 'true');
    await page.waitForLoadState('networkidle');
    await page.reload();
    await expect(page.getByRole('button', { name: '30m', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
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
