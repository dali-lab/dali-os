import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

// The task modal's Save path. Edits go through the board's patchTask, which
// has to forward every field the modal can change: status (via the move
// endpoint), the parent story, and the "Blocked by" set. Each of these used to
// look saved on the card and then revert on the next revalidation because the
// request never carried it.

const PROJECT_ID = 'project-dali-os';
const COLUMN = '[data-testid="board-column"]';
const CARD = '[data-testid="task-card"]';

// Pick an option from the field's Select/MultiSelect trigger. The modal's
// fields are labelled by their row caption, not an aria-label on the trigger.
// Not Escape to dismiss: that reaches the modal, which asks to discard the
// unsaved edit. A multi-select stays open after a pick, so click its caption.
async function pick(page: Page, field: string, option: string) {
  const row = page
    .getByRole('dialog')
    .locator('.os-field-group')
    .filter({ has: page.locator('.os-field-label', { hasText: new RegExp(`^${field}`) }) })
    .first();
  await row.locator('button[aria-haspopup="listbox"]').first().click();
  await page.getByRole('option', { name: option }).first().click();
  if (await page.getByRole('listbox').isVisible()) {
    await row.locator('.os-field-label').click();
  }
}

test.describe('Task modal save', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });
  });

  test('persists status, story, and blocked-by edits', async ({ page }) => {
    const stamp = Date.now();
    const dueAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const blockerTitle = `E2E blocker ${stamp}`;
    const taskTitle = `E2E modal save ${stamp}`;

    const blocker = await page.request.post(`/api/projects/${PROJECT_ID}/tasks`, {
      data: { title: blockerTitle, status: 'InProgress', dueAt },
    });
    expect(blocker.ok()).toBe(true);
    const created = await page.request.post(`/api/projects/${PROJECT_ID}/tasks`, {
      data: { title: taskTitle, status: 'Todo', dueAt },
    });
    expect(created.ok()).toBe(true);
    const { id } = (await created.json()) as { id: string };

    await page.goto(`/projects/${PROJECT_ID}?tab=board&embed=1&task=${id}`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Edit task' }).click();
    await pick(page, 'Status', 'In review');
    await pick(page, 'Epic', 'Staffing board v1');
    await pick(page, 'User story', 'Drag-and-drop columns');
    await pick(page, 'Blocked by', blockerTitle);

    const saved = page.waitForResponse(
      (r) => r.url().endsWith(`/api/tasks/${id}/move`) && r.request().method() === 'POST',
    );
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    expect((await saved).ok()).toBe(true);

    // Reload: what shows now is what the server kept, not the optimistic card.
    await page.goto(`/projects/${PROJECT_ID}?tab=board&embed=1`);
    await page.waitForLoadState('networkidle');
    const card = page
      .locator(COLUMN)
      .filter({ hasText: 'In review' })
      .first()
      .locator(CARD)
      .filter({ hasText: taskTitle });
    await expect(card).toBeVisible();
    await expect(card.getByText('Blocked')).toBeVisible();

    await card.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Drag-and-drop columns')).toBeVisible();
    await expect(dialog.getByText(blockerTitle)).toBeVisible();
  });
});
