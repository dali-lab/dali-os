import { test, expect } from './fixtures';
import { resetEducationApplications } from './helpers';

// Seeded fixtures (prisma/seed.ts):
//   offering-figma-workshop     — Published Workshop, RSVP (requiresReview
//                                 false), capacity 2, open registration window
//   offering-react-miniseries   — Published Miniseries, review-required
//   admin@dali.dartmouth.edu    — Admin (Core) + instructor on both offerings
//   f007al1 / f007bo2 / f007ca3 — netId-only Dartmouth students (portal)

const WORKSHOP_ID = 'offering-figma-workshop';

test.describe('education catalog', () => {
  test('member sees published offerings and can open a detail page', async ({
    page,
    loginAs,
  }) => {
    await loginAs({ daliEmail: 'jordan.taylor@dali.dartmouth.edu' });
    await page.goto('/education?embed=1');
    await expect(page.getByRole('heading', { name: 'Education' })).toBeVisible();
    await expect(page.getByText('Figma Crash Course')).toBeVisible();

    // Detail pages render standalone via ?embed=1 (client-side navigation
    // would swap in the TabWorkspace shell and move content into an iframe).
    await page.goto(`/education/${WORKSHOP_ID}?embed=1`);
    await expect(
      page.getByRole('heading', { name: 'Figma Crash Course' }),
    ).toBeVisible();
    await expect(page.getByText(/seats left|waitlist/i).first()).toBeVisible();
  });

  test('instructor sees the manage surface with builder tabs', async ({
    page,
    loginAs,
  }) => {
    await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });
    await page.goto('/education/manage?embed=1');
    await expect(
      page.getByRole('heading', { name: 'Manage education' }),
    ).toBeVisible();
    await expect(page.getByText('Figma Crash Course')).toBeVisible();

    await page.goto(`/education/manage/${WORKSHOP_ID}?embed=1`);
    await expect(page.getByRole('button', { name: 'Sessions' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Applications' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Roster' })).toBeVisible();
  });
});

test.describe('portal home dashboard', () => {
  test('non-member sees the dashboard with hiring and education cards', async ({
    page,
    loginAs,
  }) => {
    await loginAs({ netId: 'f007al1' });
    await page.goto('/portal');
    await expect(page.getByRole('heading', { name: 'Apply to DALI' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Education' })).toBeVisible();
    // Nav reaches the two sub-surfaces.
    await expect(page.getByRole('link', { name: 'Apply', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Education', exact: true })).toBeVisible();
  });
});

test.describe('portal RSVP, waitlist, and auto-promotion', () => {
  test.beforeAll(async () => {
    await resetEducationApplications(WORKSHOP_ID);
  });

  async function rsvp(page: import('@playwright/test').Page) {
    await page.goto(`/portal/education/${WORKSHOP_ID}/apply`);
    await page.getByRole('button', { name: 'RSVP' }).click();
    // The action redirects back to the offering detail page on success.
    await page.waitForURL(`**/portal/education/${WORKSHOP_ID}`);
  }

  test('two RSVPs fill the seats, the third waitlists, withdrawal promotes', async ({
    page,
    loginAs,
  }) => {
    // Seat 1: Alice.
    await loginAs({ netId: 'f007al1' });
    await rsvp(page);
    await expect(page.getByText('Enrolled', { exact: true })).toBeVisible();

    // Seat 2: Bob.
    await loginAs({ netId: 'f007bo2' });
    await rsvp(page);
    await expect(page.getByText('Enrolled', { exact: true })).toBeVisible();

    // Carol lands on the waitlist (capacity 2).
    await loginAs({ netId: 'f007ca3' });
    await rsvp(page);
    await expect(page.getByText('Waitlisted', { exact: true })).toBeVisible();

    // Alice withdraws — Carol should be promoted automatically.
    await loginAs({ netId: 'f007al1' });
    await page.goto(`/portal/education/${WORKSHOP_ID}`);
    // Withdraw confirmation is now an in-app dialog, not a native confirm.
    await page.getByRole('button', { name: 'Withdraw' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Withdraw' }).click();
    await expect(page.getByText('Withdrawn', { exact: true })).toBeVisible();

    await loginAs({ netId: 'f007ca3' });
    await page.goto(`/portal/education/${WORKSHOP_ID}`);
    await expect(page.getByText('Enrolled', { exact: true })).toBeVisible();

    // The enrolled student can open the course hub.
    await page.getByRole('link', { name: 'Open course hub' }).click();
    await expect(page.getByRole('button', { name: 'Sessions' })).toBeVisible();
  });
});
