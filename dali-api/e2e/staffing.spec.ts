import { test, expect } from './fixtures';
import { confirmDialog, openDialog } from './helpers';
import {
  createStaffingFixture,
  deleteStaffingFixture,
  projectAssignmentCount,
  type StaffingFixture,
} from './staffing.helpers';

const MANAGER = 'admin@dali.dartmouth.edu';

test.describe('Staffing board and finalize', () => {
  // The shared server is busy with other suites; the default 30s is tight.
  test.describe.configure({ mode: 'serial', timeout: 60_000 });
  let f: StaffingFixture;

  test.beforeAll(async () => {
    f = await createStaffingFixture();
  });
  test.afterAll(async () => {
    await deleteStaffingFixture(f);
  });

  test('non-manager cannot open the board or finalize', async ({ page, loginAs }) => {
    await loginAs({ daliEmail: f.email });
    await page.goto('/projects/staffing', { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/staffing/);

    const res = await page.request.post('/api/staffing/finalize', {
      data: { cycleId: f.cycleId, projectId: f.projectId, automations: ['assignments'] },
    });
    expect(res.status()).toBe(403);
    expect(await projectAssignmentCount(f)).toBe(0);
  });

  test('manager proposes a member, finalizes, and the roster persists', async ({ page, loginAs }) => {
    await loginAs({ daliEmail: MANAGER });
    await page.goto('/projects/staffing', { waitUntil: 'domcontentloaded' });

    await openDialog(page, `View ${f.fullName}'s bid`);
    const dialog = page.getByRole('dialog');
    const assign = page.waitForResponse(
      (r) => r.url().includes('/api/staffing/assign') && r.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: 'Place here' }).first().click();
    expect((await assign).ok()).toBe(true);

    // Proposed only: nothing is on the canonical roster until finalize.
    expect(await projectAssignmentCount(f)).toBe(0);

    await page.getByRole('button', { name: `Finalize ${f.projectName}` }).click();
    const modal = page.getByRole('dialog');
    await modal.getByRole('button', { name: 'Unselect all' }).click();
    const assignments = modal.getByRole('checkbox', { name: 'Propagate assignments' });
    await expect(assignments).not.toBeChecked();
    await modal
      .getByRole('listitem')
      .filter({ hasText: 'Propagate assignments' })
      .locator('span.relative')
      .click();
    await expect(assignments).toBeChecked();
    const finalize = page.waitForResponse(
      (r) => r.url().includes('/api/staffing/finalize') && r.request().method() === 'POST',
    );
    await modal.getByRole('button', { name: 'Finalize (1)' }).click();
    // Two dialogs are stacked here (the modal and its confirm), so the shared
    // confirmDialog helper's bare getByRole('dialog') would be ambiguous.
    await page
      .getByRole('dialog', { name: `Finalize ${f.projectName}?`, exact: true })
      .getByRole('button', { name: 'Finalize', exact: true })
      .click();
    const body = await (await finalize).json();
    expect(body.results.assignments.status).toBe('ok');
    await expect(modal.getByText('Review pairings')).toBeVisible();

    expect(await projectAssignmentCount(f)).toBe(1);

    await page.goto(`/projects/${f.projectId}?tab=details`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(f.fullName).first()).toBeVisible();
    await page.reload();
    await expect(page.getByText(f.fullName).first()).toBeVisible();
  });

  test('taking a confirmed member off the project removes them from the roster', async ({ page, loginAs }) => {
    await loginAs({ daliEmail: MANAGER });
    await page.goto('/projects/staffing', { waitUntil: 'domcontentloaded' });
    await openDialog(page, `Remove ${f.fullName} from project`);
    const assign = page.waitForResponse(
      (r) => r.url().includes('/api/staffing/assign') && r.request().method() === 'POST',
    );
    await confirmDialog(page, 'Remove');
    expect((await assign).ok()).toBe(true);

    expect(await projectAssignmentCount(f)).toBe(0);
    await page.goto(`/projects/${f.projectId}?tab=details`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('No team assignments yet.')).toBeVisible();
    await expect(page.getByText(f.fullName)).toHaveCount(0);
  });
});
