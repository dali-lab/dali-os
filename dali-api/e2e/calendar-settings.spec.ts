import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

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

// The unified calendar keeps these controls in toolbar popovers rather than on a
// standalone Availability tab: working hours + linked accounts live behind the
// "Calendars" button, and the event buffer behind "Event defaults".
async function openWorkingHours(page: Page) {
  await page.getByRole('button', { name: 'Calendars', exact: true }).click();
  await page.getByRole('button', { name: 'Edit working hours' }).click();
}

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
    await openWorkingHours(page);

    // The seed turned working hours on, so Monday's segment editor is present.
    await expect(page.getByLabel('Mon segment 1 start')).toBeVisible();

    // Disable Monday via its per-day toggle (only present while the master
    // switch is on).
    await page.getByRole('button', { name: /Mon enabled/i }).click();
    await expect(page.getByLabel('Mon segment 1 start')).toHaveCount(0);
    await page.waitForLoadState('networkidle');

    // Reload and assert the disabled state persists. The popover closes on
    // reload, so reopen it. The master switch stays on (other days still have
    // segments), so the editor — and Monday's toggle — remain available.
    await page.reload();
    await openWorkingHours(page);
    await expect(page.getByLabel('Mon segment 1 start')).toHaveCount(0);

    // Toggle Monday back on and confirm the segment reappears.
    await page.getByRole('button', { name: /Mon enabled/i }).click();
    await expect(page.getByLabel('Mon segment 1 start')).toBeVisible();
    await page.waitForLoadState('networkidle');
  });

  test('event buffer selection persists', async ({ page }) => {
    await page.goto('/calendar?embed=1');
    await page.getByRole('button', { name: 'Event defaults' }).click();
    // Pick 5m — a buffer-only option, so it can't collide with the identically
    // labeled default-duration chips in the same popover.
    const fiveMin = page.getByRole('button', { name: '5m', exact: true });
    await fiveMin.click();
    await expect(fiveMin).toHaveAttribute('aria-pressed', 'true');
    await page.waitForLoadState('networkidle');

    await page.reload();
    await page.getByRole('button', { name: 'Event defaults' }).click();
    await expect(page.getByRole('button', { name: '5m', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('Add Google Account link is present and points at OAuth start', async ({ page }) => {
    await page.goto('/calendar?embed=1');
    await page.getByRole('button', { name: 'Calendars', exact: true }).click();
    const link = page.getByRole('link', { name: /Add Google account/i });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/oauth/calendar/google/start');
    // Must break out of the workspace iframe so Google's auth page isn't blocked
    // by X-Frame-Options: DENY.
    await expect(link).toHaveAttribute('target', '_top');
  });
});
