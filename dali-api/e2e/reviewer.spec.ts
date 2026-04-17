import { test, expect } from './fixtures';

test.describe('reviewer workflow', () => {
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
    await expect(page).toHaveURL(/\/reviewer\/application\/.+/);
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
