import { test, expect } from './fixtures';

test.describe('domain lead workflow', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'eng.lead@dali.dartmouth.edu' });
  });

  test('dashboard loads with engineering domain section', async ({ page }) => {
    await page.goto('/domain-lead');
    await expect(page.getByRole('heading', { name: 'Domain Lead Dashboard' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Engineering' }).first()).toBeVisible();
    await expect(page.getByText('Under Review').first()).toBeVisible();
  });

  test('shows applicants table with known applicants', async ({ page }) => {
    await page.goto('/domain-lead');
    await expect(page.getByRole('columnheader', { name: 'Applicant' }).first()).toBeVisible();
    await expect(page.getByText('Alice Johnson').first()).toBeVisible();
    await expect(page.getByText('Diego Rivera').first()).toBeVisible();
  });

  test('shows locked rubric picker', async ({ page }) => {
    await page.goto('/domain-lead');
    await expect(page.getByText('Domain Rubric').first()).toBeVisible();
    await expect(page.getByText(/locked/).first()).toBeVisible();
  });

  test('shows reviewer and interviewer roster sections', async ({ page }) => {
    await page.goto('/domain-lead');
    await expect(page.getByText(/Reviewers for this Domain/).first()).toBeVisible();
    await expect(page.getByText(/Interviewers for this Domain/).first()).toBeVisible();
  });

  test('shows deliberations section', async ({ page }) => {
    await page.goto('/domain-lead');
    await expect(page.getByText('Deliberations').first()).toBeVisible();
    await expect(page.getByText('Initial Delibs').first()).toBeVisible();
    await expect(page.getByText('Final Delibs').first()).toBeVisible();
  });

  test('application detail page shows challenge responses', async ({ page }) => {
    await page.goto('/domain-lead/application/da-alice-eng');
    await expect(page.getByText('Alice Johnson')).toBeVisible();
    await expect(page.getByText('General Application')).toBeVisible();
    await expect(page.getByText('Engineering Challenge')).toBeVisible();
  });
});
