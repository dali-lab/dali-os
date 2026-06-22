import { test, expect } from './fixtures';

// One real drag test against the unified KanbanBoard primitive (PR-02).
// TaskBoard is the cleanest target: the seed gives the DALI OS project a
// workspace with a "To do" task ("Backlog: confirm → ProjectAssignment
// promotion") that we drag into the "In progress" column. This is the only way
// to catch a DnD regression that the Vitest smoke tests can't — @dnd-kit's
// PointerSensor needs real pointer movement, which we drive with mouse steps.
//
// dnd-kit's PointerSensor has an activation distance of 6px, so the drag must
// move past that threshold before it engages; we step the mouse to be safe.
test.describe('KanbanBoard drag (TaskBoard)', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });
  });

  test('dragging a task card across columns persists via /api/tasks/:id/move', async ({
    page,
  }) => {
    await page.goto('/projects/project-dali-os?tab=work');
    await page.waitForLoadState('networkidle');

    const cardTitle = 'Backlog: confirm → ProjectAssignment promotion';
    const card = page.getByText(cardTitle, { exact: false }).first();
    await expect(card).toBeVisible();

    // The drag handle is the GripVertical button on the card.
    const handle = card
      .locator('xpath=ancestor::div[contains(@class,"rounded-md")][1]')
      .getByLabel('Drag task');
    await expect(handle).toBeVisible();

    // The "In progress" column header is the drop target region.
    const inProgressHeader = page.getByText('In progress', { exact: true }).first();
    await expect(inProgressHeader).toBeVisible();

    const handleBox = await handle.boundingBox();
    const targetBox = await inProgressHeader.boundingBox();
    if (!handleBox || !targetBox) throw new Error('Missing drag geometry');

    // Watch for the move POST that the optimistic hook fires.
    const movePromise = page.waitForRequest(
      (req) =>
        /\/api\/tasks\/[^/]+\/move$/.test(req.url()) && req.method() === 'POST',
    );

    // Press on the handle, nudge past the 6px activation threshold, glide to the
    // target column in steps, then release.
    await page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      handleBox.x + handleBox.width / 2 + 12,
      handleBox.y + handleBox.height / 2 + 12,
      { steps: 5 },
    );
    await page.mouse.move(
      targetBox.x + targetBox.width / 2,
      targetBox.y + targetBox.height + 60,
      { steps: 10 },
    );
    await page.mouse.up();

    const moveReq = await movePromise;
    expect(moveReq.postDataJSON()).toMatchObject({ status: 'InProgress' });

    // The "In progress" column should now contain the card. Scope the assertion
    // to the column shell so we don't match the original position during the
    // optimistic render.
    const inProgressColumn = inProgressHeader.locator(
      'xpath=ancestor::div[contains(@class,"rounded-lg")][1]',
    );
    await expect(inProgressColumn.getByText(cardTitle, { exact: false })).toBeVisible();
  });
});
