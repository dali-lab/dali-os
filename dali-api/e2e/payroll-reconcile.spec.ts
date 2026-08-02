import { test, expect } from './fixtures';

// Payroll: Reconcile — admin uploads a synthetic TimesheetX CSV, sees the
// reconciled Payroll Data row, edits a Budget revenue cell (totals update),
// exports a CSV, and confirms a non-admin is bounced to /admin/members.
//
// PII rule: every name/netid here is synthetic (Ada Lovelace / f00pay01, the
// seed's payroll fixture student). No real export is ever read.
//
// The page is admin-only and renders standalone via ?embed=1 (client-side nav
// would wrap it in the TabWorkspace iframe — see education.spec.ts).

const ADMIN_EMAIL = 'admin@dali.dartmouth.edu';

// Seed fixture (prisma/seed.ts): student f00pay01 is assigned to project-dali-os
// (chart string below) in the active term, and jobId 4834 is a DALI Project code.
const STUDENT_NETID = 'f00pay01';
const JOB_ID = '4834';
const CHART_STRING = '18.722.161028.128512.4000';

/**
 * A valid biweekly pay-period label (Sunday start, Saturday end, 14 days
 * inclusive) whose end date lands inside the seeded active term. The seed
 * anchors term "26S" to [now-30d, now+60d], so a period ending on the most
 * recent Saturday is always inside that window — keeping the test
 * date-independent (the seed dates move with the clock).
 */
function activePayPeriodName(): string {
  const now = new Date();
  // Most recent Saturday at/ before today (UTC day 6).
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  end.setUTCDate(end.getUTCDate() - ((end.getUTCDay() + 1) % 7)); // back up to Saturday
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 13); // Sunday, 14 days inclusive
  const fmt = (d: Date) =>
    `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
  return `${fmt(start)} - ${fmt(end)}`;
}

/** Build a one-row synthetic TimesheetX timesheet CSV (real header set). */
function timesheetCsv(payPeriod: string): string {
  const headers = [
    'Pay_Period_Name',
    'Employee_Name',
    'Employee_NetID',
    'Job_Title',
    'JobID',
    'Shift_Start_Time',
    'Shift_End_Time',
    'Total_Shift_Time',
    'Hourly_Pay_Rate',
    'Total_Earnings',
    'Overtime_Hours',
    'Overtime_Earnings',
    'Pay_Code',
    'Department',
    'Supervisor_First_Name',
    'Supervisor_Last_Name',
    'Timesheet_Status',
    'Chart_String',
  ];
  const row = [
    payPeriod,
    'Lovelace, Ada',
    STUDENT_NETID,
    'DALI Lab Student Employee',
    JOB_ID,
    '09/15/2025 09:00',
    '09/15/2025 12:00',
    '3',
    '16.25',
    '48.75',
    '',
    '',
    'REG',
    'DALI Lab',
    'Admin',
    'User',
    'Approved',
    CHART_STRING,
  ];
  return `${headers.join(',')}\n${row.map((c) => (c.includes(',') ? `"${c}"` : c)).join(',')}\n`;
}

test.describe('payroll: reconcile', () => {
  test('admin uploads a timesheet, reconciles, edits budget, and exports', async ({
    page,
    loginAs,
  }) => {
    const payPeriod = activePayPeriodName();

    await loginAs({ daliEmail: ADMIN_EMAIL });
    await page.goto('/admin/payroll?embed=1');

    // Header + empty state before any upload for this term.
    await expect(
      page.getByRole('heading', { name: 'Payroll: Reconcile' }),
    ).toBeVisible();
    await expect(
      page.getByText('No timesheet data for this term yet'),
    ).toBeVisible();

    // Open the upload modal and submit the synthetic timesheet.
    await page.getByRole('button', { name: 'Upload CSV' }).first().click();
    await page.locator('input[name="timesheet"]').setInputFiles({
      name: 'timesheet.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(timesheetCsv(payPeriod)),
    });
    await page.getByRole('button', { name: 'Upload', exact: true }).click();

    // Success summary shows the import counts, then the page revalidates.
    await expect(page.getByText('Import complete')).toBeVisible();
    await expect(page.getByText(/1 created/)).toBeVisible();

    // Close the modal (it stays open showing the summary) before touching tabs.
    // Two "Close" controls exist — the header X (aria-label) and the footer
    // button; the footer one is last in DOM order.
    await page.getByRole('button', { name: 'Close' }).last().click();
    await expect(page.getByRole('dialog')).toBeHidden();

    // Payroll Data tab: the reconciled row for our student appears.
    await page.getByRole('tab', { name: 'Payroll Data' }).click();
    const dataRow = page.getByRole('row', { name: new RegExp(STUDENT_NETID) });
    await expect(dataRow).toBeVisible();
    await expect(dataRow.getByText('Ada Lovelace')).toBeVisible();

    // Budget tab: edit the revenue cell for our chart string on blur.
    await page.getByRole('tab', { name: 'Budget' }).click();
    const revenue = page.getByLabel(`Revenue for ${CHART_STRING}`);
    await expect(revenue).toBeVisible();
    await revenue.fill('1000.00');
    await revenue.blur();

    // Adj. Revenue / Net / grand totals update once the mutation revalidates.
    // Grand-total revenue reflects the entered $1,000.00.
    const grandTotal = page.getByRole('row', { name: /Grand total/ });
    await expect(grandTotal).toContainText('$1,000.00');

    // Export CSV downloads for the active tab.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Export CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
  });

  test('non-admin is redirected to /admin/members', async ({
    page,
    loginAs,
  }) => {
    // jordan.taylor is Core (can reach admin/members) but not Admin, so
    // the admin-only payroll page bounces them there.
    await loginAs({ daliEmail: 'jordan.taylor@dali.dartmouth.edu' });
    await page.goto('/admin/payroll');
    await expect(page).toHaveURL(/\/admin\/members/);
    await expect(page).not.toHaveURL(/\/admin\/payroll/);
  });
});
