import { test, expect } from './fixtures';
import { resetCycleStatus } from './helpers';

const cycleId = 'cycle-fall-2026';
const baseURL = 'http://localhost:3001';

/** Log in as hiring lead and advance the cycle to the given status. */
async function advanceCycleTo(browser: any, status: string) {
  const ctx = await browser.newContext({ baseURL });
  const page = await ctx.newPage();
  await page.goto(`/dev-login-as?daliEmail=jordan.taylor@dali.dartmouth.edu`);
  await page.waitForLoadState('networkidle');
  const resp = await page.request.post(`/api/cycles/${cycleId}/status`, {
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

    test('dashboard shows current stage', async ({ page }) => {
      await page.goto('/reviewer');
      await expect(page.getByRole('heading', { name: 'Reviewer Dashboard' })).toBeVisible();
      await expect(page.getByText('Current Stage')).toBeVisible();
      await expect(page.getByText('Applications Open')).toBeVisible();
    });

    test('shows stage progress tabs', async ({ page }) => {
      await page.goto('/reviewer');
      const main = page.locator('main');
      await expect(main.getByText('Reviews')).toBeVisible();
      await expect(main.getByText('Availability')).toBeVisible();
      await expect(main.getByText('Interviews')).toBeVisible();
      await expect(main.getByText('Decisions')).toBeVisible();
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
      await page.goto('/reviewer');
      await expect(page.getByRole('heading', { name: 'Reviewer Dashboard' })).toBeVisible();
      await expect(page.getByRole('heading', { name: /Pending/ })).toBeVisible();
      await expect(page.getByRole('heading', { name: /Submitted/ })).toBeVisible();
    });

    test('shows assigned applicant reviews', async ({ page }) => {
      await page.goto('/reviewer');
      await expect(page.getByText('Alice Johnson')).toBeVisible();
      await expect(page.getByText('Diego Rivera')).toBeVisible();
    });

    test('can navigate to a review detail page', async ({ page }) => {
      await page.goto('/reviewer');
      const reviewLink = page.getByRole('link', { name: /View Review|Continue Review|Start Review/ }).first();
      await reviewLink.waitFor({ state: 'visible' });
      await reviewLink.click();
      await expect(page).toHaveURL(/\/reviewer\/application\/.+/, { timeout: 15_000 });
    });

    test('review detail shows scoring form', async ({ page }) => {
      await page.goto('/reviewer');
      const reviewLink = page.getByRole('link', { name: /View Review|Continue Review|Start Review/ }).first();
      await reviewLink.waitFor({ state: 'visible' });
      await reviewLink.click();

      await expect(page.getByText('Your Review')).toBeVisible();

      // Engineering rubric criteria from seed data
      await expect(page.getByText('Technical Depth')).toBeVisible();
      await expect(page.getByText('Problem Solving')).toBeVisible();

      // Recommendation options
      await expect(page.getByText('Strong Hire')).toBeVisible();
      await expect(page.getByText('No Hire', { exact: true })).toBeVisible();

      // Internal Feedback collaborative editor section
      await expect(page.getByRole('heading', { name: 'Internal Feedback' })).toBeVisible();
    });
  });

  test('teardown: revert cycle to Open', async () => {
    await resetCycleStatus(cycleId);
  });
});
