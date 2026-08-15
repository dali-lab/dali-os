import { test, expect } from './fixtures';
import type { Page, Locator } from '@playwright/test';

// E2E tests for the Finder/Google-Drive-style Drive hub (drive-consolidation
// flag-gated).
//
// Model after the redesign — you browse ONE location at a time:
//   - Drive root lists the "drives" as folder rows: drive-scope-<id>
//     ("mine" = My Drive, "lab" = Lab, "core" = Core, projects). Double-click a
//     row (or deep-link ?scope=<id>) to enter it.
//   - Location is URL state: /drive?scope=<id>&folder=<pageId>. No params = root.
//   - Breadcrumb bar: data-testid="drive-breadcrumb" with crumbs
//     drive-crumb-root / drive-crumb-scope / drive-crumb-<folderId>.
//   - Search box: data-testid="drive-search" (client-side, across all drives);
//     results container drive-search-results, hit rows drive-search-hit-<id>.
//   - Type filter: a Select dropdown (data-testid="drive-filter"); options
//     All / Documents / Files / Forms / Agreements set the ?type= param.
//   - Contextual New ▾ menu (only inside a drive): drive-new-menu-<scopeId> with
//     drive-new-doc-<scopeId> / drive-new-folder-<scopeId> / drive-new-upload-
//     <scopeId> and drive-new-form; Core adds drive-new-agreement, Lab adds
//     drive-new-template.
//   - Listing rows: drive-item-<type>-<id> (doc / file / form / folder). Single
//     click selects, double click opens (folder → navigate in; leaf → editor).
//   - Row actions menu: drive-item-actions-<id> (Rename / Move to… / Delete).
//
// drive-consolidation is on for everyone by registry default, so the Drive is
// simply the app: no per-user flag row to stamp, and every member has it.
//
// ?embed=1: standalone route render (no TabWorkspace iframe shell). Required for
// dnd-kit drag tests — same pattern as kanban-drag.spec.ts.

const DRIVE_USER = 'admin@dali.dartmouth.edu';

test.describe.configure({ mode: 'serial' });

test.describe('Drive hub (drive-consolidation flag)', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: DRIVE_USER });
  });

  // ── Test A: root lists the drives + filter chips + breadcrumb; no root New ──
  test('(A) Drive root lists drives with breadcrumb + filter chips; no New menu at root; every member has Drive nav', async ({
    page,
  }) => {
    await page.goto('/drive?embed=1');
    await page.waitForLoadState('networkidle');

    // The browser surface + breadcrumb root are present.
    await expect(page.getByTestId('drive-browser')).toBeVisible();
    await expect(page.getByTestId('drive-crumb-root')).toBeVisible();

    // The drives are listed as rows (My Drive + Lab always; Core for Core users).
    await expect(page.getByTestId('drive-scope-mine')).toBeVisible();
    await expect(page.getByTestId('drive-scope-lab')).toBeVisible();

    // Type filter control (Select dropdown) + view/details toolbar controls.
    await expect(page.getByTestId('drive-filter')).toBeVisible();
    await expect(page.getByTestId('drive-view-list')).toBeVisible();
    await expect(page.getByTestId('drive-view-grid')).toBeVisible();
    await expect(page.getByTestId('drive-details-toggle')).toBeVisible();

    // No contextual New menu at the Drive root — you pick a drive first.
    await expect(page.getByTestId('drive-new-menu-lab')).toHaveCount(0);

    // ── A member with no special roles still gets the Drive ─────────────────
    const reviewerCtx = await page.context().browser()!.newContext();
    const reviewerPage = await reviewerCtx.newPage();
    const baseURL = page.url().replace(/\/drive.*/, '');
    await reviewerCtx.addCookies([{ name: 'dali_tabless', value: '0', url: baseURL }]);

    await reviewerPage.goto(`${baseURL}/dev-login-as?daliEmail=reviewer1@dali.dartmouth.edu`);
    await reviewerPage.waitForLoadState('networkidle');
    await reviewerPage.goto(`${baseURL}/`);
    await reviewerPage.waitForLoadState('networkidle');

    await expect(
      reviewerPage.locator('aside').getByRole('button', { name: 'Drive' }),
    ).toBeVisible();

    await reviewerCtx.close();
  });

  // ── Test B: enter a drive (deep-link) → New menu + doc listed ───────────────
  test('(B) Entering the Lab drive shows the contextual New menu, breadcrumb, and lists a doc', async ({
    page,
  }) => {
    const docTitle = `E2E drive doc ${Date.now()}`;
    const createRes = await page.request.post('/api/lab-documents', {
      data: { title: docTitle, kind: 'FreeForm' },
    });
    expect(createRes.ok(), `Create lab doc failed: ${await createRes.text()}`).toBe(true);
    const { id: docId } = await createRes.json() as { id: string };

    await page.goto('/drive?scope=lab&embed=1');
    await page.waitForLoadState('networkidle');

    // Breadcrumb now shows the Lab scope crumb, and the New menu is present.
    await expect(page.getByTestId('drive-crumb-scope')).toBeVisible();
    await expect(page.getByTestId('drive-new-menu-lab')).toBeVisible();

    // Opening the New menu shows the Lab items.
    await page.getByTestId('drive-new-menu-lab').click();
    await expect(page.getByTestId('drive-new-doc-lab')).toBeVisible();
    await expect(page.getByTestId('drive-new-folder-lab')).toBeVisible();
    await expect(page.getByTestId('drive-new-form')).toBeVisible();
    await expect(page.getByTestId('drive-new-template')).toBeVisible();
    await expect(page.getByTestId('drive-new-upload-lab')).toBeVisible();
    await page.keyboard.press('Escape');

    // The doc is listed at the Lab top level.
    await expect(page.getByTestId(`drive-item-doc-${docId}`)).toBeVisible();
  });

  // ── Test C: double-click a drive, then navigate into a folder ───────────────
  test('(C) Double-click into Lab, then into a folder shows the nested doc + breadcrumb', async ({
    page,
  }) => {
    const stamp = Date.now();
    const folderRes = await page.request.post('/api/lab-documents', {
      data: { title: `E2E folder ${stamp}`, kind: 'Folder' },
    });
    expect(folderRes.ok(), `Create folder failed: ${await folderRes.text()}`).toBe(true);
    const { id: folderId } = await folderRes.json() as { id: string };

    const docRes = await page.request.post('/api/lab-documents', {
      data: { title: `E2E nested doc ${stamp}`, kind: 'FreeForm' },
    });
    expect(docRes.ok(), `Create doc failed: ${await docRes.text()}`).toBe(true);
    const { id: docId } = await docRes.json() as { id: string };

    const moveRes = await page.request.post(`/api/pages/${docId}/move`, {
      data: { parentPageId: folderId },
    });
    expect(moveRes.ok(), `Move failed: ${await moveRes.text()}`).toBe(true);

    // From the root, double-click the Lab drive to enter it.
    await page.goto('/drive?embed=1');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('drive-scope-lab').dblclick();

    // The folder row is visible at the Lab top level; the nested doc is not.
    await expect(page.getByTestId(`drive-item-folder-${folderId}`)).toBeVisible();
    await expect(page.getByTestId(`drive-item-doc-${docId}`)).toHaveCount(0);

    // Double-click the folder to navigate into it.
    await page.getByTestId(`drive-item-folder-${folderId}`).dblclick();

    // Now the nested doc shows and the breadcrumb has the folder crumb.
    await expect(page.getByTestId(`drive-item-doc-${docId}`)).toBeVisible();
    await expect(page.getByTestId(`drive-crumb-${folderId}`)).toBeVisible();

    // Breadcrumb up: clicking the scope crumb returns to the Lab top level.
    await page.getByTestId('drive-crumb-scope').click();
    await expect(page.getByTestId(`drive-item-folder-${folderId}`)).toBeVisible();
  });

  // ── Test D: in-drive search finds a doc across drives ───────────────────────
  test('(D) Search filters to matching items with their path', async ({ page }) => {
    const stamp = Date.now();
    const title = `E2E searchable ${stamp}`;
    const docRes = await page.request.post('/api/lab-documents', {
      data: { title, kind: 'FreeForm' },
    });
    expect(docRes.ok(), `Create doc failed: ${await docRes.text()}`).toBe(true);
    const { id: docId } = await docRes.json() as { id: string };

    await page.goto('/drive?embed=1');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('drive-search').fill(`searchable ${stamp}`);
    await expect(page.getByTestId('drive-search-results')).toBeVisible();
    await expect(page.getByTestId(`drive-search-hit-${docId}`)).toBeVisible();

    // Clearing search returns to the drives listing.
    await page.getByTestId('drive-search').fill('');
    await expect(page.getByTestId('drive-scope-lab')).toBeVisible();
  });

  // ── Test E: type filter narrows the listing ─────────────────────────────────
  //
  // Drives the filter via the ?type= param (the source of truth the Select
  // writes to) so the assertion is deterministic — the Select's own dropdown
  // interaction isn't re-tested here (its presence is covered in Test A).
  test('(E) Forms filter hides docs; Documents filter shows them', async ({ page }) => {
    const stamp = Date.now();
    const docRes = await page.request.post('/api/lab-documents', {
      data: { title: `E2E filter doc ${stamp}`, kind: 'FreeForm' },
    });
    expect(docRes.ok(), `Create doc failed: ${await docRes.text()}`).toBe(true);
    const { id: docId } = await docRes.json() as { id: string };

    // Forms filter: the doc is hidden.
    await page.goto('/drive?scope=lab&type=form&embed=1');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('drive-browser')).toBeVisible();
    await expect(page.getByTestId(`drive-item-doc-${docId}`)).toHaveCount(0);

    // Documents filter: the doc is shown.
    await page.goto('/drive?scope=lab&type=doc&embed=1');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId(`drive-item-doc-${docId}`)).toBeVisible();
  });

  // ── Test F: row "⋯" menu renames a doc ──────────────────────────────────────
  test('(F) Row actions menu renames a document', async ({ page }) => {
    const stamp = Date.now();
    const createRes = await page.request.post('/api/lab-documents', {
      data: { title: `E2E rename src ${stamp}`, kind: 'FreeForm' },
    });
    expect(createRes.ok(), `Create doc failed: ${await createRes.text()}`).toBe(true);
    const { id: docId } = await createRes.json() as { id: string };

    await page.goto('/drive?scope=lab&embed=1');
    await page.waitForLoadState('networkidle');

    const row = page.getByTestId(`drive-item-doc-${docId}`);
    await expect(row).toBeVisible();
    await row.hover();
    await page.getByTestId(`drive-item-actions-${docId}`).click();

    await page.getByRole('menuitem', { name: 'Rename' }).click();
    const input = page.locator('[role="dialog"] input[type="text"]');
    await expect(input).toBeVisible();
    const newTitle = `E2E renamed ${stamp}`;
    await input.fill(newTitle);
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByTestId(`drive-item-doc-${docId}`).getByText(newTitle)).toBeVisible();
  });

  // ── Test G: My Drive create via naming prompt ───────────────────────────────
  test('(G) My Drive scope creates a document via the naming prompt', async ({ page }) => {
    const stamp = Date.now();
    await page.goto('/drive?scope=mine&embed=1');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('drive-new-menu-mine').click();
    await expect(page.getByTestId('drive-new-upload-mine')).toBeVisible();
    await page.getByTestId('drive-new-doc-mine').click();

    const input = page.locator('[role="dialog"] input[type="text"]');
    await expect(input).toBeVisible();
    await input.fill(`My note ${stamp}`);

    await Promise.all([
      page.waitForURL(/\/documents\//, { timeout: 10_000 }),
      page.getByRole('button', { name: 'Create' }).click(),
    ]);
    expect(page.url()).toMatch(/\/documents\//);
  });

  // ── Test H: Core drive auto-provisions for Core members ─────────────────────
  test('(H) Core drive is listed at root for a Core member and accepts a new doc', async ({ page }) => {
    const stamp = Date.now();
    await page.goto('/drive?embed=1');
    await page.waitForLoadState('networkidle');

    // Core drive row is present at the root for the Core admin.
    await expect(page.getByTestId('drive-scope-core')).toBeVisible();

    // Enter it and create a doc via its own New menu.
    await page.goto('/drive?scope=core&embed=1');
    await page.waitForLoadState('networkidle');
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

  // ── Test I: New→Agreement (Core) ─────────────────────────────────────────────
  test('(I) New→Agreement creates an agreement and navigates to /documents/agreement/', async ({
    page,
  }) => {
    await page.goto('/drive?scope=core&embed=1');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('drive-new-menu-core').click();
    await expect(page.getByTestId('drive-new-agreement')).toBeVisible();

    await Promise.all([
      page.waitForURL(/\/documents\/agreement\//, { timeout: 10_000 }),
      page.getByTestId('drive-new-agreement').click(),
    ]);
    expect(page.url()).toMatch(/\/documents\/agreement\//);
  });

  // ── Test J: real dnd-kit drag moves a doc into a folder ──────────────────────
  test('(J) Dragging a doc into a folder persists the move', async ({ page }) => {
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

    await page.goto('/drive?scope=lab&embed=1');
    await page.waitForLoadState('networkidle');

    const docRow = page.getByTestId(`drive-item-doc-${docId}`);
    const folderRow = page.getByTestId(`drive-item-folder-${folderId}`);
    await expect(docRow).toBeVisible();
    await expect(folderRow).toBeVisible();

    const movePromise = page.waitForRequest(
      (req) => req.url().includes(`/api/pages/${docId}/move`) && req.method() === 'POST',
    );

    await dragHandleTo(page, docRow, folderRow);
    await movePromise;

    // The doc leaves the Lab top level (now inside the folder). Navigate in.
    await page.goto('/drive?embed=1');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('drive-scope-lab').dblclick();
    await page.getByTestId(`drive-item-folder-${folderId}`).dblclick();
    await expect(page.getByTestId(`drive-item-doc-${docId}`)).toBeVisible();
  });

  // ── Test K: multi-select shows the bulk action bar ───────────────────────────
  test('(K) Ctrl/Cmd-clicking two rows shows the bulk action bar', async ({ page }) => {
    const stamp = Date.now();
    const a = await page.request.post('/api/lab-documents', { data: { title: `E2E bulk a ${stamp}`, kind: 'FreeForm' } });
    const b = await page.request.post('/api/lab-documents', { data: { title: `E2E bulk b ${stamp}`, kind: 'FreeForm' } });
    expect(a.ok() && b.ok(), 'create docs failed').toBe(true);
    const { id: idA } = await a.json() as { id: string };
    const { id: idB } = await b.json() as { id: string };

    await page.goto('/drive?scope=lab&embed=1');
    await page.waitForLoadState('networkidle');

    await page.getByTestId(`drive-item-doc-${idA}`).click();
    await page.getByTestId(`drive-item-doc-${idB}`).click({ modifiers: ['Control'] });

    const bar = page.getByTestId('drive-bulk-bar');
    await expect(bar).toBeVisible();
    await expect(bar.getByText('2 selected')).toBeVisible();
  });

  // ── Test L: view toggle switches list/grid + sort header present ─────────────
  test('(L) Grid/list view toggle works and sortable column header is present', async ({ page }) => {
    const stamp = Date.now();
    const res = await page.request.post('/api/lab-documents', { data: { title: `E2E view ${stamp}`, kind: 'FreeForm' } });
    expect(res.ok(), 'create doc failed').toBe(true);

    await page.goto('/drive?scope=lab&embed=1');
    await page.waitForLoadState('networkidle');

    // List view is default → the sortable Name header is present.
    await expect(page.getByTestId('drive-sort-name')).toBeVisible();

    // Switch to grid: the grid toggle becomes pressed and the column header goes away.
    await page.getByTestId('drive-view-grid').click();
    await expect(page.getByTestId('drive-view-grid')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('drive-sort-name')).toHaveCount(0);

    // Back to list.
    await page.getByTestId('drive-view-list').click();
    await expect(page.getByTestId('drive-sort-name')).toBeVisible();
  });
});

// ── Drag helper (adapted from kanban-drag.spec.ts) ────────────────────────────
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
  await page.mouse.move(startX + 4, startY + 4, { steps: 3 });
  await page.mouse.move(startX + 12, startY + 12, { steps: 5 });
  await page.mouse.move(endX, endY, { steps: 15 });
  await page.mouse.move(endX, endY);
  await page.mouse.up();
}
