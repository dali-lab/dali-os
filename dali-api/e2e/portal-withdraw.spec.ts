import { test, expect } from './fixtures';

test.describe('portal: withdraw application', () => {
  test('applicant can withdraw a submitted application from the portal', async ({ page, loginAs }) => {
    // Kenji is seeded with a submitted Engineering application but no reviews —
    // the cleanest "Submitted" candidate to drive a withdraw flow against.
    await loginAs({ netId: 'f007ke1' });

    await page.goto('/portal/application');
    await expect(page).toHaveURL(/\/portal\/application/);

    // Open the confirmation modal
    await page.getByRole('button', { name: /withdraw application/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Confirm
    await page.getByRole('dialog').getByRole('button', { name: 'Withdraw' }).click();

    // After the fetcher resolves, the page revalidates and shows the withdrawn notice.
    await expect(page.getByText(/you withdrew this application/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /withdraw application/i })).toHaveCount(0);

    // Dashboard should show the withdrawn state too.
    // Use client-side nav to avoid racing with React Router's post-fetcher
    // revalidation, which can abort a concurrent full-page goto in CI.
    await page.getByRole('link', { name: /back to portal/i }).click();
    await expect(page.getByText(/application withdrawn/i)).toBeVisible();
  });
});
