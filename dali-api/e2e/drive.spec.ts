import { test, expect } from './fixtures';
import type { Page, Locator } from '@playwright/test';
import { enableDriveFlagForUser, clearDriveFlag } from './helpers';

// E2E tests for the reshaped Drive hub (drive-consolidation flag-gated).
//
// IA after the reshape:
//   - Browse is the only main view (data-testid="drive-browse").
//   - Type filter chips: drive-filter-all|doc|file|form (folders always show).
//   - Per-scope New ▾ menu: data-testid="drive-new-menu-<scopeId>" (e.g. -lab,
//     -mine). Base items: drive-new-doc-<scopeId>, drive-new-folder-<scopeId>.
//     The Lab menu also carries drive-new-form (Core), drive-new-agreement
//     (Core), drive-new-template, drive-new-upload-<scope>. Every drive has upload. Create opens a naming
//     prompt (dialog) before the item is made.
//   - Scope sections: drive-scope-<id> — "mine" (My Drive) + "lab" + "core"
//     (Core drive, Core members only, auto-provisioned) + projects.
//   - Trees inside: data-testid="drive-tree"
//   - Item rows in tree: drive-item-<type>-<id>   (doc / file / form / folder)
//   - Folder rows:       drive-folder-<id>
//   - Row actions menu:  drive-item-actions-<id> (Rename / Move to… / Delete)
//
// Agreements and Templates secondary shelves have been removed from the hub:
//   - Signed agreements are in Settings → Agreements.
//   - Page templates are accessed via New ▾ → From template…
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

  // ── Test A: unified render + filter chips + New menu items ──────────────────
  //
  // Creates a Lab doc and navigates to /drive?embed=1. Asserts:
  //   - drive-browse container is visible
  //   - All / Documents / Files / Forms filter chips are present
  //   - drive-new-menu button is visible; opening it shows all New items
  //   - drive-new-template and drive-new-upload-lab are present
  //   - The created doc appears in the tree (All view)
  //   - Switching to the Documents filter still shows the doc
  //   - Switching to the Forms filter hides the doc
  //   - Agreements + Templates secondary shelves are NOT present (removed)
  //   - Non-targeted user (reviewer1) has no Drive area in sidebar nav

  test('(A) Browse renders with filter chips + New menu (incl. template + upload); doc visible in All + Documents; hidden under Forms filter; shelves gone; non-targeted user has no Drive nav', async ({
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

    // New ▾ menu trigger must be visible.
    await expect(page.getByTestId('drive-new-menu-lab')).toBeVisible();

    // Agreements + Templates secondary shelf triggers must NOT be present.
    await expect(page.getByTestId('drive-shelf-agreements')).not.toBeVisible();
    await expect(page.getByTestId('drive-shelf-templates')).not.toBeVisible();

    // ── New ▾ menu: open and verify items ────────────────────────────────────
    await page.getByTestId('drive-new-menu-lab').click();
    // Menu items are rendered in a FloatingPortal; they should appear in DOM.
    await expect(page.getByTestId('drive-new-doc-lab')).toBeVisible();
    await expect(page.getByTestId('drive-new-folder-lab')).toBeVisible();
    await expect(page.getByTestId('drive-new-form')).toBeVisible();
    await expect(page.getByTestId('drive-new-template')).toBeVisible();
    await expect(page.getByTestId('drive-new-upload-lab')).toBeVisible();
    // Close the menu by pressing Escape.
    await page.keyboard.press('Escape');

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

  // ── Test E: New → From template opens the picker ────────────────────────────
  //
  // Opens New ▾ and clicks "From template…". Asserts the TemplatePicker modal
  // renders. If there are seeded page templates they appear; otherwise the
  // "No page templates" empty state is shown. Either way the picker itself must
  // be visible — this test never asserts a specific template row (would be
  // flaky depending on seed state).

  test('(E) New → From template… opens the template picker modal', async ({ page }) => {
    await page.goto('/drive?embed=1');
    await page.waitForLoadState('networkidle');

    // Open the New menu.
    await page.getByTestId('drive-new-menu-lab').click();
    await expect(page.getByTestId('drive-new-template')).toBeVisible();

    // Click "From template…" — closes the menu and opens the modal.
    await page.getByTestId('drive-new-template').click();

    // The modal contains an <h2> with "From template" text.
    await expect(page.getByRole('heading', { name: /from template/i })).toBeVisible();

    // Either a template list, an empty-state message, or a loading indicator
    // must appear — the picker itself is open.
    const pickerRendered = await Promise.race([
      page.waitForSelector('text=No page templates', { timeout: 5000 }).then(() => true),
      page.waitForSelector('text=Loading templates', { timeout: 5000 }).then(() => true),
      page.waitForSelector('[role="dialog"] ul', { timeout: 5000 }).then(() => true),
    ]).catch(() => false);
    expect(pickerRendered).toBe(true);

    // Cancel closes the modal.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: /from template/i })).not.toBeVisible();
  });

  // ── Test F: Agreements filter chip is visible for Core users ─────────────────
  //
  // Asserts the drive-filter-agreement chip is visible (Core = canManageAgreements)
  // and the drive-new-agreement item appears in the New ▾ menu.

  test('(F) Agreements filter chip and New→Agreement menu item visible for Core user', async ({
    page,
  }) => {
    await page.goto('/drive?embed=1');
    await page.waitForLoadState('networkidle');

    // Agreements filter chip is visible for Core (admin@dali.dartmouth.edu is Core).
    await expect(page.getByTestId('drive-filter-agreement')).toBeVisible();

    // Opening the New menu shows the New agreement item.
    await page.getByTestId('drive-new-menu-lab').click();
    await expect(page.getByTestId('drive-new-agreement')).toBeVisible();

    // Close menu.
    await page.keyboard.press('Escape');
  });

  // ── Test G: New→Agreement navigates to /documents/agreement/ ─────────────────
  //
  // Clicks New → Agreement, waits for navigation, and asserts the final URL
  // is under /documents/agreement/. Non-flaky because the create action always
  // succeeds for a Core user.

  test('(G) New→Agreement creates an agreement and navigates to /documents/agreement/', async ({
    page,
  }) => {
    await page.goto('/drive?embed=1');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('drive-new-menu-lab').click();
    await expect(page.getByTestId('drive-new-agreement')).toBeVisible();

    // Click the menu item and wait for navigation.
    await Promise.all([
      page.waitForURL(/\/documents\/agreement\//, { timeout: 10_000 }),
      page.getByTestId('drive-new-agreement').click(),
    ]);

    expect(page.url()).toMatch(/\/documents\/agreement\//);
  });

  // ── Test H: My Drive scope + naming prompt on create ────────────────────────
  //
  // The private "My Drive" scope (drive-scope-mine) has its own New ▾ menu.
  // Creating a document opens a naming prompt (dialog), and confirming navigates
  // to the new personal note. Exercises the My Drive scope + the create prompt.

  test('(H) My Drive scope creates a document via the naming prompt', async ({ page }) => {
    const stamp = Date.now();
    await page.goto('/drive?embed=1');
    await page.waitForLoadState('networkidle');

    // My Drive scope renders and opens by default.
    await expect(page.getByTestId('drive-scope-mine')).toBeVisible();

    // Open the My Drive New menu; it offers doc/folder AND upload (files live
    // in My Drive too, privately), then pick New document.
    await page.getByTestId('drive-new-menu-mine').click();
    await expect(page.getByTestId('drive-new-upload-mine')).toBeVisible();
    await page.getByTestId('drive-new-doc-mine').click();

    // A naming prompt (dialog) appears; fill it and confirm.
    const input = page.locator('[role="dialog"] input[type="text"]');
    await expect(input).toBeVisible();
    await input.fill(`My note ${stamp}`);

    await Promise.all([
      page.waitForURL(/\/documents\//, { timeout: 10_000 }),
      page.getByRole('button', { name: 'Create' }).click(),
    ]);
    expect(page.url()).toMatch(/\/documents\//);
  });

  // ── Test I: row "⋯" menu renames a doc (non-DnD management) ──────────────────
  //
  // Creates a Lab doc, opens its row actions menu, renames it via the prompt,
  // and asserts the tree shows the new title after revalidation.

  test('(I) Row actions menu renames a document', async ({ page }) => {
    const stamp = Date.now();
    const createRes = await page.request.post('/api/lab-documents', {
      data: { title: `E2E rename src ${stamp}`, kind: 'FreeForm' },
    });
    expect(createRes.ok(), `Create doc failed: ${await createRes.text()}`).toBe(true);
    const { id: docId } = await createRes.json() as { id: string };

    await page.goto('/drive?embed=1');
    await page.waitForLoadState('networkidle');

    // The row and its actions trigger are present (button reveals on hover but
    // is in the DOM; click it directly).
    await expect(page.getByTestId(`drive-item-doc-${docId}`)).toBeVisible();
    await page.getByTestId(`drive-item-actions-${docId}`).click();

    // Rename opens the prompt pre-filled with the current title.
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    const input = page.locator('[role="dialog"] input[type="text"]');
    await expect(input).toBeVisible();
    const newTitle = `E2E renamed ${stamp}`;
    await input.fill(newTitle);
    await page.getByRole('button', { name: 'Save' }).click();

    // Tree revalidates and the row shows the new title.
    await expect(page.getByTestId(`drive-item-doc-${docId}`).getByText(newTitle)).toBeVisible();
  });

  // ── Test J: Core drive is auto-provisioned for Core members ──────────────────
  //
  // admin@dali.dartmouth.edu is Core, so the Core drive (drive-scope-core) is
  // ensured on first visit and creating a doc in it lands a Core-scoped page.
  // (Non-Core exclusion + the no-leak cascade are covered by the pageAccess unit
  // tests; the seed provisions the core GroupDefinition via syncDefaultGroups.)

  test('(J) Core drive auto-provisions for a Core member and accepts a new doc', async ({ page }) => {
    const stamp = Date.now();
    await page.goto('/drive?embed=1');
    await page.waitForLoadState('networkidle');

    // The Core drive section renders for the Core admin.
    await expect(page.getByTestId('drive-scope-core')).toBeVisible();

    // Create a document into the Core drive via its own New menu (which also
    // offers upload — Core files land inside the Core folder, Core-only).
    await page.getByTestId('drive-new-menu-core').click();
    await expect(page.getByTestId('drive-new-upload-core')).toBeVisible();
    await page.getByTestId('drive-new-doc-core').click();

    const input = page.locator('[role="dialog"] input[type="text"]');
    await expect(input).toBeVisible();
    await input.fill(`Core doc ${stamp}`);

    await Promise.all([
      page.waitForURL(/\/documents\//, { timeout: 10_000 }),
      page.getByRole('button', { name: 'Create' }).click(),
    ]);
    expect(page.url()).toMatch(/\/documents\//);
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
