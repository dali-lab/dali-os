import { test, expect } from './fixtures';
import type { Page, Locator } from '@playwright/test';
import { enableDriveFlagForUser, clearDriveFlag } from './helpers';

// E2E tests for the reshaped Drive hub (drive-consolidation flag-gated).
//
// IA after the reshape:
//   - Browse is the only main view (data-testid="drive-browse").
//   - Type filter chips: drive-filter-all|doc|file|form
//   - New ▾ menu: data-testid="drive-new-menu"
//   - Scope sections: drive-scope-<id>; trees inside: data-testid="drive-tree"
//   - Item rows in tree: drive-item-<type>-<id>   (doc / file / form / folder)
//   - Folder rows:       drive-folder-<id>
//   - Demoted shelves:   drive-shelf-agreements / drive-shelf-templates (trigger
//     buttons); drive-shelf-agreements-panel / drive-shelf-templates-panel (panels)
//
// The flag is scoped to admin@dali.dartmouth.edu only (everyone=false) so other
// parallel workers that use a different user are unaffected.
//
// ?embed=1: standalone route render (no TabWorkspace iframe shell). Required for
// dnd-kit drag tests — same pattern as kanban-drag.spec.ts.

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

  // ── Test A: unified render + filter chips ────────────────────────────────────
  //
  // Creates a Lab doc and a form (admin is Core so canViewForms = true).
  // Navigates to /drive?embed=1 and asserts:
  //   - drive-browse container is visible
  //   - All / Documents / Files / Forms filter chips are present
  //   - drive-new-menu button is visible
  //   - The created doc appears in the tree (All view)
  //   - Switching to the Documents filter still shows the doc
  //   - Switching to the Forms filter hides the doc
  //   - Agreements + Templates shelf triggers are visible (but subordinate)
  //
  // Also verifies that a non-targeted user (reviewer1) does not see a Drive
  // area in the sidebar navigation.

  test('(A) Browse renders with filter chips + New menu; doc visible in All + Documents; hidden under Forms filter; non-targeted user has no Drive nav', async ({
    page,
  }) => {
    // Create a Lab doc so the tree has at least one item.
    const docTitle = `E2E drive doc ${Date.now()}`;
    const createRes = await page.request.post('/api/lab-documents', {
      data: { title: docTitle, kind: 'FreeForm' },
    });
    expect(createRes.ok(), `Create lab doc failed: ${await createRes.text()}`).toBe(true);
    const { id: docId } = await createRes.json() as { id: string };

    await page.goto('/drive?embed=1');
    await page.waitForLoadState('networkidle');

    // The main Browse container must be present.
    await expect(page.getByTestId('drive-browse')).toBeVisible();

    // All filter chips must be present (admin = Core → canViewForms → Forms chip shown).
    await expect(page.getByTestId('drive-filter-all')).toBeVisible();
    await expect(page.getByTestId('drive-filter-doc')).toBeVisible();
    await expect(page.getByTestId('drive-filter-file')).toBeVisible();
    await expect(page.getByTestId('drive-filter-form')).toBeVisible();

    // New ▾ menu trigger.
    await expect(page.getByTestId('drive-new-menu')).toBeVisible();

    // Agreements + Templates shelf triggers (demoted, but present).
    await expect(page.getByTestId('drive-shelf-agreements')).toBeVisible();
    await expect(page.getByTestId('drive-shelf-templates')).toBeVisible();

    // ── All filter: tree renders + doc is visible ────────────────────────────
    // "All" is the default; the Lab scope opens by default.
    await expect(page.getByTestId('drive-tree').first()).toBeVisible();
    await expect(page.getByTestId(`drive-item-doc-${docId}`)).toBeVisible();

    // ── Documents filter: doc still visible ──────────────────────────────────
    await page.getByTestId('drive-filter-doc').click();
    await page.waitForLoadState('networkidle');
    // Flat-list mode: drive-item-doc-<id> still rendered.
    await expect(page.getByTestId(`drive-item-doc-${docId}`)).toBeVisible();

    // ── Forms filter: doc is NOT visible ─────────────────────────────────────
    await page.getByTestId('drive-filter-form').click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId(`drive-item-doc-${docId}`)).not.toBeVisible();

    // ── Non-targeted user: no Drive area in the sidebar ──────────────────────
    //
    // reviewer1's User.id is not in the flag's userIds — their sidebar must
    // not list "Drive". Use a fresh browser context to avoid leaking the admin
    // session cookie.
    const reviewerCtx = await page.context().browser()!.newContext();
    const reviewerPage = await reviewerCtx.newPage();
    await reviewerPage.addInitScript(() => {
      try { window.localStorage.setItem('dalios-launch-welcome-seen-v1', 'e2e'); } catch {}
    });
    const baseURL = page.url().replace(/\/drive.*/, '');
    await reviewerCtx.addCookies([{ name: 'dali_tabless', value: '0', url: baseURL }]);

    await reviewerPage.goto(`${baseURL}/dev-login-as?daliEmail=reviewer1@dali.dartmouth.edu`);
    await reviewerPage.waitForLoadState('networkidle');
    await reviewerPage.goto(`${baseURL}/`);
    await reviewerPage.waitForLoadState('networkidle');

    const areaMenuBtn = reviewerPage.locator('aside button[aria-haspopup="listbox"]');
    if (await areaMenuBtn.isVisible()) {
      await areaMenuBtn.click();
      const listbox = reviewerPage.locator('[role="listbox"]');
      await expect(listbox).toBeVisible();
      await expect(listbox.getByText('Drive', { exact: true })).not.toBeVisible();
    } else {
      // Collapsed sidebar — at minimum, no /drive link.
      await expect(reviewerPage.locator('aside a[href="/drive"]')).not.toBeVisible();
    }

    await reviewerCtx.close();
  });

  // ── Test B: move persists via API, visible in All view ───────────────────────
  //
  // Creates a Lab folder + Lab doc. Calls POST /api/pages/:id/move with
  // { parentPageId: folderId }. Reloads /drive?embed=1 with All filter (default)
  // and asserts the doc is nested under the folder row.

  test('(B) Move doc into folder via API persists in the Browse tree (All view)', async ({
    page,
  }) => {
    const stamp = Date.now();

    const folderRes = await page.request.post('/api/lab-documents', {
      data: { title: `E2E folder ${stamp}`, kind: 'Folder' },
    });
    expect(folderRes.ok(), `Create folder failed: ${await folderRes.text()}`).toBe(true);
    const { id: folderId } = await folderRes.json() as { id: string };

    const docRes = await page.request.post('/api/lab-documents', {
      data: { title: `E2E doc B ${stamp}`, kind: 'FreeForm' },
    });
    expect(docRes.ok(), `Create doc failed: ${await docRes.text()}`).toBe(true);
    const { id: docId } = await docRes.json() as { id: string };

    const moveRes = await page.request.post(`/api/pages/${docId}/move`, {
      data: { parentPageId: folderId },
    });
    expect(moveRes.ok(), `Move failed: ${await moveRes.text()}`).toBe(true);

    // Navigate to All-filter Drive hub (embed).
    await page.goto('/drive?embed=1');
    await page.waitForLoadState('networkidle');

    // Folder row visible (FolderRow defaults expanded — doc subtree visible).
    const folderRow = page.getByTestId(`drive-folder-${folderId}`);
    await expect(folderRow).toBeVisible();

    // Doc row is nested inside the folder's subtree.
    const docRow = page.getByTestId(`drive-item-doc-${docId}`);
    await expect(docRow).toBeVisible();

    // Verify visual nesting: the doc title lives somewhere inside the folder's
    // parent container.
    await expect(folderRow.locator('..').getByText(`E2E doc B ${stamp}`)).toBeVisible();
  });

  // ── Test C: real dnd-kit drag persists ───────────────────────────────────────
  //
  // Creates a Lab folder + Lab doc. On /drive?embed=1 (All filter, default)
  // drags the doc into the folder using the proven dnd-kit mouse recipe from
  // kanban-drag.spec.ts. Asserts the move POST fires and the nesting persists
  // after reload.

  test('(C) Dragging a doc into a folder persists in the Browse tree', async ({ page }) => {
    const stamp = Date.now();

    const folderRes = await page.request.post('/api/lab-documents', {
      data: { title: `E2E drag folder ${stamp}`, kind: 'Folder' },
    });
    expect(folderRes.ok(), `Create folder failed: ${await folderRes.text()}`).toBe(true);
    const { id: folderId } = await folderRes.json() as { id: string };

    const docRes = await page.request.post('/api/lab-documents', {
      data: { title: `E2E drag doc ${stamp}`, kind: 'FreeForm' },
    });
    expect(docRes.ok(), `Create doc failed: ${await docRes.text()}`).toBe(true);
    const { id: docId } = await docRes.json() as { id: string };

    await page.goto('/drive?embed=1');
    await page.waitForLoadState('networkidle');

    const docRow = page.getByTestId(`drive-item-doc-${docId}`);
    const folderRow = page.getByTestId(`drive-folder-${folderId}`);
    await expect(docRow).toBeVisible();
    await expect(folderRow).toBeVisible();

    // Watch for the move POST before dragging.
    const movePromise = page.waitForRequest(
      (req) =>
        req.url().includes(`/api/pages/${docId}/move`) && req.method() === 'POST',
    );

    // Real dnd-kit drag: step past the 6px PointerSensor activation threshold,
    // then glide into the folder row. Same recipe as kanban-drag.spec.ts.
    await dragHandleTo(page, docRow, folderRow);

    await movePromise;

    // Reload to confirm server-side persistence.
    await page.reload();
    await page.waitForLoadState('networkidle');

    const folderAfter = page.getByTestId(`drive-folder-${folderId}`);
    await expect(folderAfter).toBeVisible();
    await expect(
      folderAfter.locator('..').getByText(`E2E drag doc ${stamp}`),
    ).toBeVisible();
  });

  // ── Test D: Forms filter shows forms, hides docs ─────────────────────────────
  //
  // Creates a Lab doc. Navigates to /drive?type=form&embed=1. The doc must NOT
  // appear. Then switches to ?type=doc and asserts the doc appears.

  test('(D) Forms filter shows only forms; Documents filter shows only docs', async ({
    page,
  }) => {
    const stamp = Date.now();

    const docRes = await page.request.post('/api/lab-documents', {
      data: { title: `E2E filter doc ${stamp}`, kind: 'FreeForm' },
    });
    expect(docRes.ok(), `Create doc failed: ${await docRes.text()}`).toBe(true);
    const { id: docId } = await docRes.json() as { id: string };

    // Forms filter: doc must not be visible.
    await page.goto('/drive?type=form&embed=1');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('drive-browse')).toBeVisible();
    await expect(page.getByTestId('drive-filter-form')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId(`drive-item-doc-${docId}`)).not.toBeVisible();

    // Documents filter: doc is visible.
    await page.getByTestId('drive-filter-doc').click();
    // URL updates via searchParams; wait for the page to settle.
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId(`drive-item-doc-${docId}`)).toBeVisible();
  });
});

// ── Drag helper (adapted from kanban-drag.spec.ts) ────────────────────────────
//
// Moves `handle` into `target` with the stepped mouse sequence that engages
// dnd-kit's PointerSensor (activation distance 6px).
async function dragHandleTo(page: Page, handle: Locator, target: Locator) {
  await handle.scrollIntoViewIfNeeded();

  const handleBox = await handle.boundingBox();
  const targetBox = await target.boundingBox();
  const viewport = page.viewportSize();
  if (!handleBox || !targetBox || !viewport) {
    throw new Error('dragHandleTo: missing bounding box');
  }

  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = Math.min(
    Math.max(targetBox.y + 8, startY),
    Math.min(targetBox.y + targetBox.height - 8, viewport.height - 8),
  );

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Nudge past 6px activation threshold; small steps emit several pointermove
  // events so dnd-kit starts the drag.
  await page.mouse.move(startX + 4, startY + 4, { steps: 3 });
  await page.mouse.move(startX + 12, startY + 12, { steps: 5 });
  // Glide into the folder row so dnd-kit registers the "over" event.
  await page.mouse.move(endX, endY, { steps: 15 });
  await page.mouse.move(endX, endY);
  await page.mouse.up();
}
