import { test, expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';

// One real drag test against the unified KanbanBoard primitive (PR-02).
// TaskBoard is the cleanest target: the seed gives the DALI OS project a
// workspace with at least one "To do" task that we drag into the "In progress"
// column. This is the only way to catch a DnD regression that the Vitest smoke
// tests can't — @dnd-kit's PointerSensor needs real pointer movement, which we
// drive with mouse steps.
//
// Two things the spec has to get right or the drag silently no-ops:
//  1. The project page normally renders inside the TabWorkspace iframe shell; a
//     top-level navigation lands on the empty "No tabs open" workspace. We append
//     `?embed=1` (the same flag the iframe uses) so the route renders standalone,
//     matching the pattern in calendar-settings.spec.ts.
//  2. "To do" / "In progress" also appear as status labels elsewhere on the
//     page, so columns must be scoped to the KanbanBoard shell
//     (`div.w-64.rounded-lg` — see KanbanBoard.tsx BoardColumn shellClass),
//     not matched by text anywhere on the page.
//
// dnd-kit's PointerSensor has an activation distance of 6px, so the drag must
// move past that threshold before it engages; we step the mouse to be safe.
// The whole card — title included — is the drag source (no grip handle, no
// selectable text); a sub-threshold press still counts as the click that
// opens the task modal.

// Test ids, not Tailwind classes: both shells dress the column and the card
// differently (radius, fill), and the selectors silently stopped matching when
// the dali.os design landed.
const COLUMN = '[data-testid="board-column"]';
// The card container — the sortable wrapper spreads the drag listeners onto it.
const CARD = '[data-testid="task-card"]';

const column = (page: Page, label: string): Locator =>
  page.locator(COLUMN).filter({ hasText: label }).first();

// Drag `handle` into `target`, stepping past the 6px activation threshold first
// so the PointerSensor engages, then gliding into the column.
async function dragHandleTo(page: Page, handle: Locator, target: Locator) {
  // Bring the card into view before measuring — a mouse drag to off-viewport
  // coordinates never reaches the element.
  await handle.scrollIntoViewIfNeeded();

  const handleBox = await handle.boundingBox();
  const targetBox = await target.boundingBox();
  const viewport = page.viewportSize();
  if (!handleBox || !targetBox || !viewport) {
    throw new Error('Missing drag geometry');
  }

  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  // Drop at the destination column's horizontal centre, on the same row band as
  // the (now visible) handle. The columns share a row, so the handle's y is
  // inside the destination column's visible area too — no risk of aiming
  // above/below the fold for a tall column.
  const endX = targetBox.x + targetBox.width / 2;
  const endY = Math.min(
    Math.max(startY, targetBox.y + 8),
    Math.min(targetBox.y + targetBox.height - 8, viewport.height - 8),
  );

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Nudge past the 6px activation threshold to engage the PointerSensor; the
  // small steps emit several pointermove events so dnd-kit starts the drag.
  await page.mouse.move(startX + 4, startY + 4, { steps: 3 });
  await page.mouse.move(startX + 12, startY + 12, { steps: 5 });
  // Glide into the destination column in steps so dnd-kit registers the over,
  // then settle in place before release.
  await page.mouse.move(endX, endY, { steps: 15 });
  await page.mouse.move(endX, endY);
  await page.mouse.up();
}

const PROJECT_ID = 'project-dali-os';

test.describe('KanbanBoard drag (TaskBoard)', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });
  });

  test('dragging a task card across columns persists via /api/tasks/:id/move', async ({
    page,
  }) => {
    // Create our own "To do" card via the API so the test is deterministic
    // regardless of the seed baseline or prior runs/retries (which mutate the
    // shared DB by moving tasks between columns). The login cookie set by
    // loginAs is reused by page.request.
    const cardTitle = `E2E drag ${Date.now()}`;
    const created = await page.request.post(`/api/projects/${PROJECT_ID}/tasks`, {
      data: { title: cardTitle, status: 'Todo' },
    });
    expect(created.ok()).toBe(true);

    // ?embed=1 renders the project route standalone (no workspace iframe shell).
    await page.goto(`/projects/${PROJECT_ID}?tab=board&embed=1`);
    await page.waitForLoadState('networkidle');

    const todoColumn = column(page, 'To do');
    const inProgressColumn = column(page, 'In progress');
    await expect(todoColumn).toBeVisible();
    await expect(inProgressColumn).toBeVisible();

    // The card we just created, scoped to the "To do" column. The card itself
    // is the drag source now — there is no separate grip handle.
    const card = todoColumn.locator(CARD).filter({ hasText: cardTitle }).first();
    await expect(card).toBeVisible();

    // Watch for the move POST that the optimistic hook fires.
    const movePromise = page.waitForRequest(
      (req) =>
        /\/api\/tasks\/[^/]+\/move$/.test(req.url()) && req.method() === 'POST',
    );

    await dragHandleTo(page, card, inProgressColumn);

    const moveReq = await movePromise;
    expect(moveReq.postDataJSON()).toMatchObject({ status: 'InProgress' });

    // Optimistic render: the card now lives in the "In progress" column.
    await expect(
      column(page, 'In progress').getByText(cardTitle, { exact: false }),
    ).toBeVisible();

    // Persistence: reload from the server and confirm the card stuck in
    // "In progress".
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(
      column(page, 'In progress').getByText(cardTitle, { exact: false }),
    ).toBeVisible();
  });
});
