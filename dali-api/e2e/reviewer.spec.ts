import { test, expect } from './fixtures';
import { resetCycleStatus } from './helpers';

const cycleId = 'cycle-fall-2026';
const baseURL = 'http://localhost:3001';

// Reviewer pages render inside the workspace iframe. The Hiring sidebar area
// is childless, so a direct navigation seeds the tab with the area label.
const reviewsFrame = (page: import('@playwright/test').Page) =>
  page.frameLocator('iframe[title="Hiring"]');

// My work's review queue is the shared KanbanBoard: a column's name is a plain
// div inside the column shell, not a heading, so match the column by its
// test id and its text rather than by role.
const boardColumn = (frame: ReturnType<typeof reviewsFrame>, name: string) =>
  frame.locator('[data-testid="board-column"]').filter({ hasText: name }).first();

/** Log in as hiring lead and advance the cycle to the given status. */
async function advanceCycleTo(browser: any, status: string) {
  const ctx = await browser.newContext({ baseURL });
  const page = await ctx.newPage();
  await page.goto(`/dev-login-as?daliEmail=jordan.taylor@dali.dartmouth.edu`);
  await page.waitForLoadState('networkidle');
  const resp = await page.request.post(`/api/hiring/cycles/${cycleId}/status`, {
    data: { newStatus: status },
  });
  expect(resp.ok()).toBeTruthy();
  await page.close();
  await ctx.close();
}

test.describe.serial('reviewer workflow', () => {
  test.describe('while cycle is Open', () => {
    test.beforeEach(async ({ loginAs }) => {
      await loginAs({ daliEmail: 'reviewer1@dali.dartmouth.edu' });
    });

    test('dashboard loads', async ({ page }) => {
      await page.goto('/hiring');
      const frame = reviewsFrame(page);
      await expect(frame.getByRole('heading', { name: 'My work' })).toBeVisible();
      await expect(frame.getByText(/^Pending$|assigned applications yet/).first()).toBeVisible({ timeout: 10_000 });
    });

  });

  test('advance cycle to UnderReview', async ({ browser }) => {
    await advanceCycleTo(browser, 'UnderReview');
  });

  test.describe('while cycle is UnderReview', () => {
    test.beforeEach(async ({ loginAs }) => {
      await loginAs({ daliEmail: 'reviewer1@dali.dartmouth.edu' });
    });

    test('dashboard shows review columns', async ({ page }) => {
      await page.goto('/hiring');
      const frame = reviewsFrame(page);
      await expect(frame.getByRole('heading', { name: 'My work' })).toBeVisible();
      await expect(boardColumn(frame, 'Pending')).toBeVisible({ timeout: 10_000 });
      await expect(boardColumn(frame, 'Submitted')).toBeVisible();
    });

    test('shows assigned applicant reviews', async ({ page }) => {
      await page.goto('/hiring');
      const frame = reviewsFrame(page);
      await expect(frame.getByText('Alice Johnson')).toBeVisible({ timeout: 10_000 });
      await expect(frame.getByText('Diego Rivera')).toBeVisible();
    });

    test('review detail page shows scoring form', async ({ page }) => {
      // Get the review link href and navigate directly to avoid hydration
      // timing issues with client-side router click handling on CI.
      await page.goto('/hiring');
      const frame = reviewsFrame(page);
      const reviewLink = frame.getByRole('link', { name: /View review|Continue review|Start review/i }).first();
      await reviewLink.waitFor({ state: 'visible', timeout: 15_000 });
      const href = await reviewLink.getAttribute('href');
      expect(href).toMatch(/\/hiring\/reviewer\/application\/.+/);
      await page.goto(href!);

      // The application detail also renders inside the Reviews iframe.
      await expect(frame.getByRole('heading', { name: 'Your review' })).toBeVisible({ timeout: 10_000 });

      // Engineering rubric criteria from seed data
      await expect(frame.getByText('Technical Depth')).toBeVisible();
      await expect(frame.getByText('Problem Solving')).toBeVisible();

      // Recommendation options
      await expect(frame.getByText('Strong Hire')).toBeVisible();
      await expect(frame.getByText('No Hire', { exact: true })).toBeVisible();

      // Collaborative notes sections on the review panel.
      await expect(frame.getByRole('heading', { name: 'Internal feedback' })).toBeVisible();
      await expect(frame.getByRole('heading', { name: /Rejection rationale/ })).toBeVisible();
    });
  });

  test('teardown: revert cycle to Open', async () => {
    await resetCycleStatus(cycleId);
  });
});
