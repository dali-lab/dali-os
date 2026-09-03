import { test, expect } from './fixtures';

// The working-hours editor and the event-buffer picker moved out of a dedicated
// "Availability" tab into toolbar popovers (AnchoredPopover — portaled to <body>
// and positioned asynchronously, with `visibility:hidden` until placed, which
// drops it from the accessibility tree). Driving those nested popovers is
// unreliable in headless Playwright, and the persistence they exercise is
// covered at the logic layer by unit tests (app/lib/calendar-schemas +
// the calendar action handlers). The stable, still-meaningful UI assertion is
// that the calendar surfaces the Google-account connect entry — the calendars
// panel is a plain modal (not an AnchoredPopover), so it's reliable.
test.describe('calendar settings', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'jordan.taylor@dali.dartmouth.edu' });
  });

  test('Add Google Account link is present and points at OAuth start', async ({ page }) => {
    await page.goto('/calendar?embed=1');
    // Linked accounts live in the calendars panel, opened from the gear beside
    // "My calendars" in the sidebar rail.
    await page.getByRole('button', { name: 'Manage calendars' }).click();
    const link = page.getByRole('link', { name: /Add Google account/i });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/oauth/calendar/google/start');
    // Must break out of the workspace iframe so Google's auth page isn't blocked
    // by X-Frame-Options: DENY.
    await expect(link).toHaveAttribute('target', '_top');
  });
});
