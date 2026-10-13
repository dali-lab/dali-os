import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

// The task modal's Save path. Edits go through the board's patchTask, which
// has to forward every field the modal can change: status (via the move
// endpoint), epic, and sprint.

const PROJECT_ID = 'project-dali-os';
const COLUMN = '[data-testid="board-column"]';
const CARD = '[data-testid="task-card"]';

// Pick an option from the field's Select trigger. Not Escape to dismiss: that
// reaches the modal, which asks to discard the unsaved edit.
async function pick(page: Page, field: string, option: string | RegExp) {
  const row = page
    .getByRole('dialog')
    .locator('.os-field-group')
    .filter({ has: page.locator('.os-field-label', { hasText: new RegExp(`^${field}`) }) })
    .first();
  await row.locator('button[aria-haspopup="listbox"]').first().click();
  await page.getByRole('option', { name: option }).first().click();
}

test.describe('Task modal save', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });
  });

  test('schedules a backlog task into the current sprint with its status and epic', async ({
    page,
  }) => {
    const taskTitle = `E2E modal save ${Date.now()}`;
    const created = await page.request.post(`/api/projects/${PROJECT_ID}/tasks`, {
      data: { title: taskTitle, status: 'Todo' },
    });
    expect(created.ok()).toBe(true);
    const { id } = (await created.json()) as { id: string };

    await page.goto(`/projects/${PROJECT_ID}?tab=board&embed=1&task=${id}`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Edit task' }).click();
    await pick(page, 'Status', 'In review');
    await pick(page, 'Epic', 'Staffing board v1');
    await pick(page, 'Sprint', /· current/);

    const saved = page.waitForResponse(
      (r) => r.url().endsWith(`/api/tasks/${id}/move`) && r.request().method() === 'POST',
    );
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    expect((await saved).ok()).toBe(true);

    // Reload: the card now sits on the current sprint's board, In review.
    await page.goto(`/projects/${PROJECT_ID}?tab=board&embed=1`);
    await page.waitForLoadState('networkidle');
    const card = page
      .locator(COLUMN)
      .filter({ hasText: 'In review' })
      .first()
      .locator(CARD)
      .filter({ hasText: taskTitle });
    await expect(card).toBeVisible();

    await card.click();
    await expect(page.getByRole('dialog').getByText('Staffing board v1')).toBeVisible();
  });
});
