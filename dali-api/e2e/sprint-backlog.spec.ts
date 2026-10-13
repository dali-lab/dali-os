import { test, expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { dragHandleTo } from './helpers';

// Sprint planning end to end: a task written into the backlog is dragged into
// the current sprint on the Backlog tab, then shows on the sprint board, where
// it moves across columns.

const PROJECT_ID = 'project-dali-os';
const COLUMN = '[data-testid="board-column"]';

const column = (page: Page, label: string | RegExp): Locator =>
  page.locator(COLUMN).filter({ hasText: label }).first();

test.describe('Backlog → sprint', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });
  });

  test('drag a backlog task into the current sprint, then across the board', async ({ page }) => {
    const title = `E2E backlog ${Date.now()}`;

    await page.goto(`/projects/${PROJECT_ID}?tab=backlog&embed=1`);
    await page.waitForLoadState('networkidle');

    const input = page.getByRole('textbox', { name: 'New backlog task' });
    await input.fill(title);
    await input.press('Enter');

    const backlog = column(page, 'Backlog');
    const card = backlog.locator('[data-testid="plan-card"]').filter({ hasText: title });
    await expect(card).toBeVisible();

    const current = column(page, 'Current');
    const scheduled = page.waitForRequest(
      (req) => /\/api\/tasks\/[^/]+\/move$/.test(req.url()) && req.method() === 'POST',
    );
    await dragHandleTo(page, card, current);
    const body = (await scheduled).postDataJSON() as { sprintId?: string };
    expect(typeof body.sprintId).toBe('string');
    await expect(current.getByText(title)).toBeVisible();

    // The sprint board opens on the current sprint, where the card now lives.
    await page.goto(`/projects/${PROJECT_ID}?tab=board&embed=1`);
    await page.waitForLoadState('networkidle');
    const todo = column(page, 'To do');
    const boardCard = todo.locator('[data-testid="task-card"]').filter({ hasText: title });
    await expect(boardCard).toBeVisible();

    const moved = page.waitForRequest(
      (req) => /\/api\/tasks\/[^/]+\/move$/.test(req.url()) && req.method() === 'POST',
    );
    await dragHandleTo(page, boardCard, column(page, 'In progress'));
    expect((await moved).postDataJSON()).toMatchObject({ status: 'InProgress' });

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(column(page, 'In progress').getByText(title)).toBeVisible();
  });
});
