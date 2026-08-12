import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { enableDriveFlagForUser, clearDriveFlag } from './helpers';

// E2E tests for the drive-consolidation unified Drive hub (flag-gated).
//
// The flag is scoped to admin@dali.dartmouth.edu only (userIds=[id]), so
// parallel worker specs that use other users or check for Documents/Forms in
// the sidebar are not affected.
//
// ?embed=1: renders the route standalone without the TabWorkspace iframe shell,
// exactly as the workspace would load it. Required for dnd-kit drag tests
// (same pattern as kanban-drag.spec.ts).
//
// All three tests run serially: beforeAll enables the flag, afterAll clears it.

const DRIVE_USER = 'admin@dali.dartmouth.edu';

test.describe.configure({ mode: 'serial' });

test.describe('Drive hub (drive-consolidation flag)', () => {
  test.beforeAll(async () => {
    await enableDriveFlagForUser(DRIVE_USER);
  });

  test.afterAll(async () => {
    await clearDriveFlag();
  });

  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: DRIVE_USER });
  });

  // ── Test A: unified render ────────────────────────────────────────────────
  //
  // Creates a Lab doc via POST /api/lab-documents, navigates to /drive?embed=1,
  // asserts the Browse tree renders, the doc appears, and the lens pills include
  // Browse + Forms (admin is Core). Also checks that a non-targeted user
  // (reviewer1) does not see a "Drive" entry in the sidebar area menu.

  test('(A) Browse tree renders with a new doc, Forms pill visible for Core; non-targeted user has no Drive nav', async ({
    page,
    loginAs,
  }) => {
    // Create a test doc so the Browse lens has at least one item.
    const docTitle = `E2E drive doc ${Date.now()}`;
    const createRes = await page.request.post('/api/lab-documents', {
      data: { title: docTitle, kind: 'FreeForm' },
    });
    expect(createRes.ok(), `Create lab doc failed: ${await createRes.text()}`).toBe(true);
    const { id: docId } = await createRes.json() as { id: string };

    // Navigate to the Drive hub in standalone (embed) mode.
    await page.goto('/drive?embed=1');
    await page.waitForLoadState('networkidle');

    // The Browse lens container and the Browse pill must be present.
    await expect(page.getByTestId('drive-browse-lens')).toBeVisible();
    await expect(page.getByTestId('drive-lens-pill-browse')).toBeVisible();

    // Forms pill is shown for Core/Admin users.
    await expect(page.getByTestId('drive-lens-pill-forms')).toBeVisible();

    // The drive-tree renders (the lab scope defaults open, so it should be
    // immediately visible without any expand interaction).
    await expect(page.getByTestId('drive-tree').first()).toBeVisible();

    // The new doc appears in the tree.
    await expect(page.getByTestId(`drive-item-doc-${docId}`)).toBeVisible();

    // ── Non-targeted user: no Drive area in the sidebar ─────────────────────
    //
    // reviewer1 is a plain member whose User.id is NOT in the flag's userIds.
    // We check their sidebar: the area picker must not list "Drive".
    // Use a fresh browser context to avoid leaking the admin session cookie.
    const reviewerCtx = await page.context().browser()!.newContext();
    const reviewerPage = await reviewerCtx.newPage();
    // Suppress launch-welcome modal and force tabbed mode (matching fixtures.ts).
    await reviewerPage.addInitScript(() => {
      try { window.localStorage.setItem('dalios-launch-welcome-seen-v1', 'e2e'); } catch {}
    });
    const baseURL = page.url().replace(/\/drive.*/, '');
    await reviewerCtx.addCookies([{ name: 'dali_tabless', value: '0', url: baseURL }]);

    await reviewerPage.goto(`${baseURL}/dev-login-as?daliEmail=reviewer1@dali.dartmouth.edu`);
    await reviewerPage.waitForLoadState('networkidle');

    // Navigate to a page that uses the sidebar (non-embed). Home is stable.
    await reviewerPage.goto(`${baseURL}/`);
    await reviewerPage.waitForLoadState('networkidle');

    // Open the area menu (the button that lists all nav areas).
    const areaMenuBtn = reviewerPage.locator('aside button[aria-haspopup="listbox"]');
    if (await areaMenuBtn.isVisible()) {
      await areaMenuBtn.click();
      // The listbox should not contain a "Drive" option.
      const listbox = reviewerPage.locator('[role="listbox"]');
      await expect(listbox).toBeVisible();
      await expect(listbox.getByText('Drive', { exact: true })).not.toBeVisible();
    } else {
      // Sidebar may be collapsed — at minimum, no link to /drive in the sidebar.
      await expect(reviewerPage.locator('aside a[href="/drive"]')).not.toBeVisible();
    }

    await reviewerCtx.close();
  });

  // ── Test B: move persists via API (no drag needed) ────────────────────────
  //
  // Creates a Lab folder + a Lab doc; calls POST /api/pages/<docId>/move with
  // { parentPageId: folderId } (same workspace, so workspaceType is omitted);
  // reloads /drive?embed=1; expands the folder; asserts the doc is nested.

  test('(B) Move doc into folder via API persists in the Browse tree', async ({ page }) => {
    const stamp = Date.now();

    // Create a top-level Lab folder.
    const folderRes = await page.request.post('/api/lab-documents', {
      data: { title: `E2E folder ${stamp}`, kind: 'Folder' },
    });
    expect(folderRes.ok(), `Create folder failed: ${await folderRes.text()}`).toBe(true);
    const { id: folderId } = await folderRes.json() as { id: string };

    // Create a top-level Lab doc.
    const docRes = await page.request.post('/api/lab-documents', {
      data: { title: `E2E doc B ${stamp}`, kind: 'FreeForm' },
    });
    expect(docRes.ok(), `Create doc failed: ${await docRes.text()}`).toBe(true);
    const { id: docId } = await docRes.json() as { id: string };

    // Move the doc into the folder. Payload: { parentPageId: folderId }.
    // No workspaceType/workspaceId needed — same workspace (Lab) reorder.
    const moveRes = await page.request.post(`/api/pages/${docId}/move`, {
      data: { parentPageId: folderId },
    });
    expect(moveRes.ok(), `Move failed: ${await moveRes.text()}`).toBe(true);

    // Navigate to Drive hub to verify persistence.
    await page.goto('/drive?embed=1');
    await page.waitForLoadState('networkidle');

    // The folder row is visible and expanded by default (FolderRow starts expanded).
    const folderRow = page.getByTestId(`drive-folder-${folderId}`);
    await expect(folderRow).toBeVisible();

    // The doc row must be nested inside the folder subtree, which means it
    // appears after the folder row in the DOM (as a child in the tree render).
    const docRow = page.getByTestId(`drive-item-doc-${docId}`);
    await expect(docRow).toBeVisible();

    // Confirm the doc is visually inside the folder's subtree by checking that
    // the folder contains the doc title somewhere in its subtree.
    await expect(folderRow.locator(`..`).getByText(`E2E doc B ${stamp}`)).toBeVisible();
  });

  // ── Test C: real drag persists ────────────────────────────────────────────
  //
  // Creates a Lab folder + a Lab doc via API; on /drive?embed=1, drags the doc
  // row into the folder row using the proven dnd-kit mouse recipe from
  // kanban-drag.spec.ts. Asserts persistence after reload.

  test('(C) Dragging a doc into a folder persists in the Browse tree', async ({ page }) => {
    const stamp = Date.now();

    // Create a top-level Lab folder.
    const folderRes = await page.request.post('/api/lab-documents', {
      data: { title: `E2E drag folder ${stamp}`, kind: 'Folder' },
    });
    expect(folderRes.ok(), `Create folder failed: ${await folderRes.text()}`).toBe(true);
    const { id: folderId } = await folderRes.json() as { id: string };

    // Create a top-level Lab doc (starts at root, will be dragged into the folder).
    const docRes = await page.request.post('/api/lab-documents', {
      data: { title: `E2E drag doc ${stamp}`, kind: 'FreeForm' },
    });
    expect(docRes.ok(), `Create doc failed: ${await docRes.text()}`).toBe(true);
    const { id: docId } = await docRes.json() as { id: string };

    // Navigate to Drive hub standalone (embed=1).
    await page.goto('/drive?embed=1');
    await page.waitForLoadState('networkidle');

    // Both rows must be visible before we start dragging.
    const docRow = page.getByTestId(`drive-item-doc-${docId}`);
    const folderRow = page.getByTestId(`drive-folder-${folderId}`);
    await expect(docRow).toBeVisible();
    await expect(folderRow).toBeVisible();

    // Watch for the move POST that the optimistic handler fires.
    const movePromise = page.waitForRequest(
      (req) =>
        req.url().includes(`/api/pages/${docId}/move`) && req.method() === 'POST',
    );

    // Drag the doc into the folder using the proven dnd-kit recipe:
    // nudge past the 6px PointerSensor activation threshold, then glide.
    await dragHandleTo(page, docRow, folderRow);

    // Confirm the move request fired.
    await movePromise;

    // Reload to confirm server-side persistence (same check as kanban spec).
    await page.reload();
    await page.waitForLoadState('networkidle');

    // After reload the folder is still expanded (default), so the doc should
    // appear under it. Verify via the folder's subtree text.
    const folderAfter = page.getByTestId(`drive-folder-${folderId}`);
    await expect(folderAfter).toBeVisible();
    await expect(
      folderAfter.locator('..').getByText(`E2E drag doc ${stamp}`),
    ).toBeVisible();
  });
});

// ── Drag helper (adapted from kanban-drag.spec.ts) ─────────────────────────
//
// Moves `handle` into `target` with the stepped mouse sequence that engages
// dnd-kit's PointerSensor (activation distance 6px). Keeps the same structure
// as the kanban recipe so future reviewers can see it's the same approach.
async function dragHandleTo(page: Page, handle: import('@playwright/test').Locator, target: import('@playwright/test').Locator) {
  await handle.scrollIntoViewIfNeeded();

  const handleBox = await handle.boundingBox();
  const targetBox = await target.boundingBox();
  const viewport = page.viewportSize();
  if (!handleBox || !targetBox || !viewport) {
    throw new Error('dragHandleTo: missing bounding box');
  }

  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  // Drop onto the folder row's centre — the folder is a droppable, so landing
  // anywhere on it registers the "over" event.
  const endX = targetBox.x + targetBox.width / 2;
  const endY = Math.min(
    Math.max(targetBox.y + 8, startY),
    Math.min(targetBox.y + targetBox.height - 8, viewport.height - 8),
  );

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Nudge past the 6px activation threshold; small steps emit several
  // pointermove events so dnd-kit starts the drag.
  await page.mouse.move(startX + 4, startY + 4, { steps: 3 });
  await page.mouse.move(startX + 12, startY + 12, { steps: 5 });
  // Glide into the folder row in steps so dnd-kit registers the "over" event.
  await page.mouse.move(endX, endY, { steps: 15 });
  await page.mouse.move(endX, endY);
  await page.mouse.up();
}
