import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// A tab switch is client-side state, so a click that lands before the page
// hydrates does nothing and the test would sit on the wrong tab. Retry the
// click until the tab's own content shows up.
async function openTab(
  page: Page,
  name: string,
  content: ReturnType<Page['getByRole']>,
) {
  await expect(async () => {
    await page.getByRole('tab', { name, exact: true }).click();
    await expect(content.first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

test.describe('hiring lead workflow', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'jordan.taylor@dali.dartmouth.edu' });
  });

  test('cycles list shows active cycle and controls', async ({ page }) => {
    await page.goto('/hiring/lead');
    await expect(page.getByRole('heading', { name: 'Cycles', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /New cycle/ })).toBeVisible();
    await expect(page.getByText('Fall 2026').first()).toBeVisible();
    await expect(page.getByText('Open').first()).toBeVisible();
  });

  test('can navigate to cycle detail', async ({ page }) => {
    await page.goto('/hiring/lead');
    await page.getByRole('link', { name: /Fall 2026/ }).click();
    await expect(page.getByRole('tab', { name: 'Setup', exact: true })).toBeVisible();
  });

  test('cycle detail shows a tab per timeline block, by name', async ({ page }) => {
    await page.goto('/hiring/lead');
    await page.getByRole('link', { name: /Fall 2026/ }).click();

    // Tabs are the timeline's blocks, by name. The seeded cycle uses the
    // standard timeline.
    for (const name of ['Setup', 'Review', 'First delib', 'Interviews', 'Final delib', 'Decisions']) {
      await expect(page.getByRole('tab', { name, exact: true })).toBeVisible();
    }
  });

  test('cycle setup tab shows domains', async ({ page }) => {
    await page.goto('/hiring/lead');
    await page.getByRole('link', { name: /Fall 2026/ }).click();
    await openTab(page, 'Setup', page.getByRole('heading', { name: 'Term and dates', exact: true }));

    await expect(page.getByText('Engineering').first()).toBeVisible();
    await expect(page.getByText('Design').first()).toBeVisible();
    await expect(page.getByText('Product').first()).toBeVisible();
  });

  test('interviews phase shows the interview schedule config', async ({ page }) => {
    await page.goto('/hiring/lead');
    await page.getByRole('link', { name: /Fall 2026/ }).click();
    // The shared Select's trigger is a combobox (floating-ui's listbox role),
    // not a button.
    await openTab(page, 'Interviews', page.getByRole('combobox', { name: 'Slot length' }));

    await expect(page.getByRole('combobox', { name: 'Slot length' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Buffer between interviews' })).toBeVisible();
  });

  test('setup tab stacks its sections as cards', async ({ page }) => {
    await page.goto('/hiring/lead');
    await page.getByRole('link', { name: /Fall 2026/ }).click();
    await openTab(page, 'Setup', page.getByRole('heading', { name: 'Term and dates', exact: true }));

    // Setup owns the term, the audience and the editable timeline. (The side
    // nav beside them only renders at lg and up, so it isn't asserted here.)
    for (const name of ['Term and dates', 'Audience', 'Timeline']) {
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    }
  });

  test('decision emails show as status here, edited through Core', async ({ page }) => {
    await page.goto('/hiring/lead');
    await page.getByRole('link', { name: /Fall 2026/ }).click();
    await openTab(page, 'Setup', page.getByRole('heading', { name: 'Term and dates', exact: true }));

    // One shared row per slot. The seed writes a Rejected email, so the row
    // shows its subject rather than the "No email yet" warning — which is the
    // one thing a lead still needs from this tab, because releasing a decision
    // with no email written fails.
    const row = page.getByText('Sent when a rejection is released.').locator('xpath=../..');
    await expect(row).toContainText('Subject:');

    // No per-cycle editor. The copy is shared by every cycle, so it is Core's:
    // a Core viewer's row opens Core's own editor in place, and the footer link
    // reaches that editor's home directly rather than via a redirect chain.
    await expect(row.getByRole('button', { name: /^(Edit|Write)$/ })).toHaveCount(0);
    const coreLink = page.getByRole('link', { name: /See all in Core/ }).first();
    await expect(coreLink).toBeVisible();
    await expect(coreLink).toHaveAttribute('href', '/core/communications/email');

    // Jordan holds a Core assignment, so the row itself is the edit affordance.
    await page.getByRole('button', { name: 'Edit Rejected email' }).click();
    const editor = page.getByRole('dialog');
    await expect(editor).toBeVisible();
    await expect(editor.getByRole('heading', { name: 'Decision: not accepted' })).toBeVisible();
    await expect(editor.getByRole('button', { name: 'Save changes' })).toBeVisible();
  });

  test('review tab holds the reviewer and interviewer rosters', async ({ page }) => {
    await page.goto('/hiring/lead');
    await page.getByRole('link', { name: /Fall 2026/ }).click();
    await openTab(page, 'Review', page.getByRole('heading', { name: 'Reviewers', exact: true }));

    await expect(page.getByRole('heading', { name: 'Reviewers', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Interviewers', exact: true })).toBeVisible();
    // A Students cycle can fill a domain's roster from its mentors.
    await expect(page.getByRole('button', { name: 'Add all mentors' }).first()).toBeVisible();
  });

  test('decisions tab lists finalized decisions waiting to be sent', async ({ page }) => {
    await page.goto('/hiring/lead');
    await page.getByRole('link', { name: /Fall 2026/ }).click();
    await page.getByRole('tab', { name: 'Decisions', exact: true }).click();

    // Grace's Final "Rejected" decision is seeded unreleased.
    await expect(page.getByText('Grace Okafor').first()).toBeVisible();
  });
});
