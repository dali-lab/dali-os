import { test, expect } from './fixtures';
import {
  openAs,
  createLabDoc,
  userIdByEmail,
  shareIntent,
  editorOf,
  persistedMarkdown,
  openDoc,
  EDITOR_READY,
  deleteDocs,
  type DocUser,
} from './docs.helpers';

// Documents: persistence through Hocuspocus, live two-user collaboration, and
// the share dialog's access rules. Plain members (not Core) are used so
// access comes from the share rows, never from a Core override.
//   owner = Riley Okonkwo, member = Sam Alvarez, outsider = Isabela Ferreira.
// New lab docs default to "Everyone in the lab", so createLabDoc restricts them.
const OWNER = 'reviewer1@dali.dartmouth.edu';
const MEMBER = 'reviewer2@dali.dartmouth.edu';
const OUTSIDER = 'design.lead@dali.dartmouth.edu';

const stamp = Math.random().toString(36).slice(2, 8);
const created: string[] = [];
const opened: DocUser[] = [];

test.afterAll(async () => {
  for (const u of opened) await u.context.close().catch(() => {});
  await deleteDocs(created);
});

async function typeIntoEditor(page: import('@playwright/test').Page, text: string) {
  const editor = editorOf(page);
  await expect(editor).toHaveAttribute('contenteditable', 'true', EDITOR_READY);
  await editor.click();
  await page.keyboard.type(text);
}

test.describe('Documents', () => {
  test.setTimeout(300_000);

  test('typed heading and paragraph persist to the database and survive a reload', async ({ page, loginAs }) => {
    await loginAs({ daliEmail: OWNER });
    const id = await createLabDoc(page, `E2E persist ${stamp}`);
    created.push(id);

    await openDoc(page, id);
    await typeIntoEditor(page, `# Plan ${stamp}\nBody line ${stamp}`);
    await expect(editorOf(page)).toContainText(`Body line ${stamp}`);

    await expect
      .poll(() => persistedMarkdown(page, id), { timeout: 60_000 })
      .toMatch(new RegExp(`# Plan ${stamp}[\\s\\S]*Body line ${stamp}`));

    await page.reload();
    await expect(editorOf(page).getByRole('heading', { name: `Plan ${stamp}` })).toBeVisible();
    await expect(editorOf(page)).toContainText(`Body line ${stamp}`);
  });

  test('text typed by one user appears for another without a reload', async ({ page, loginAs, browser }) => {
    await loginAs({ daliEmail: OWNER });
    const id = await createLabDoc(page, `E2E live ${stamp}`);
    created.push(id);
    await shareIntent(page, id, {
      intent: 'share-add',
      principalType: 'User',
      principalId: await userIdByEmail(MEMBER),
      permission: 'Edit',
    });

    const other = await openAs(browser, MEMBER);
    opened.push(other);
    await openDoc(page, id);
    await openDoc(other.page, id);
    await expect(editorOf(page)).toHaveAttribute('contenteditable', 'true', EDITOR_READY);
    await expect(editorOf(other.page)).toHaveAttribute('contenteditable', 'true', EDITOR_READY);

    await typeIntoEditor(page, `from owner ${stamp}`);
    await expect(editorOf(other.page)).toContainText(`from owner ${stamp}`);

    await typeIntoEditor(other.page, ` and member ${stamp}`);
    await expect(editorOf(page)).toContainText(`and member ${stamp}`);

    await expect
      .poll(() => persistedMarkdown(page, id), { timeout: 60_000 })
      .toContain(`and member ${stamp}`);
  });

  test('sharing: View is read-only, unshared members are denied, Edit lets the member write', async ({
    page,
    loginAs,
    browser,
  }) => {
    await loginAs({ daliEmail: OWNER });
    const id = await createLabDoc(page, `E2E share ${stamp}`);
    created.push(id);
    const memberId = await userIdByEmail(MEMBER);

    await openDoc(page, id);
    await typeIntoEditor(page, `owner text ${stamp}`);
    await expect.poll(() => persistedMarkdown(page, id), { timeout: 60_000 }).toContain(`owner text ${stamp}`);

    // Share through the dialog: search a member by name, pick them (View by default).
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('Add people by name').fill('Alvarez');
    const added = page.waitForResponse(
      (r) => r.url().includes(`/api/pages/${id}/share`) && r.request().method() === 'POST' &&
        (r.request().postData() ?? '').includes('share-add'),
    );
    await dialog.getByRole('button', { name: /Sam Alvarez/ }).click();
    expect((await added).ok()).toBe(true);
    await expect(dialog.getByLabel('Access level for Sam Alvarez')).toBeVisible();
    await page.keyboard.press('Escape');

    const viewer = await openAs(browser, MEMBER);
    opened.push(viewer);
    await openDoc(viewer.page, id);
    await expect(editorOf(viewer.page)).toContainText(`owner text ${stamp}`);
    await expect(editorOf(viewer.page)).toHaveAttribute('contenteditable', 'false', EDITOR_READY);

    // A lab member with no share and a Restricted doc cannot open it.
    const outsider = await openAs(browser, OUTSIDER);
    opened.push(outsider);
    const denied = await outsider.page.goto(`/documents/${id}`, { waitUntil: 'domcontentloaded' });
    expect(denied?.status()).toBeGreaterThanOrEqual(403);
    await expect(editorOf(outsider.page)).toHaveCount(0);
    await expect(outsider.page.getByText(`owner text ${stamp}`)).toHaveCount(0);

    // Raise the member to Edit: they can now type, and it persists.
    await shareIntent(page, id, {
      intent: 'share-change',
      principalType: 'User',
      principalId: memberId,
      permission: 'Edit',
    });
    await openDoc(viewer.page, id);
    await expect(editorOf(viewer.page)).toHaveAttribute('contenteditable', 'true', EDITOR_READY);
    await typeIntoEditor(viewer.page, ` edited by member ${stamp}`);
    await expect
      .poll(() => persistedMarkdown(page, id), { timeout: 60_000 })
      .toContain(`edited by member ${stamp}`);
  });

  test('general access "Everyone in the lab" opens an unshared doc to a lab member', async ({
    page,
    loginAs,
    browser,
  }) => {
    await loginAs({ daliEmail: OWNER });
    const id = await createLabDoc(page, `E2E general ${stamp}`);
    created.push(id);
    await openDoc(page, id);
    await typeIntoEditor(page, `lab wide ${stamp}`);
    await expect.poll(() => persistedMarkdown(page, id), { timeout: 60_000 }).toContain(`lab wide ${stamp}`);

    const outsider = await openAs(browser, OUTSIDER);
    opened.push(outsider);
    const before = await outsider.page.goto(`/documents/${id}`, { waitUntil: 'domcontentloaded' });
    expect(before?.status()).toBeGreaterThanOrEqual(403);

    await page.getByRole('button', { name: 'Share', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const changed = page.waitForResponse(
      (r) => r.url().includes(`/api/pages/${id}/share`) && (r.request().postData() ?? '').includes('general-access'),
    );
    await dialog.getByLabel('General access audience').click();
    await page.getByRole('option', { name: /Everyone in the lab/ }).click();
    expect((await changed).ok()).toBe(true);

    await openDoc(outsider.page, id);
    await expect(editorOf(outsider.page)).toContainText(`lab wide ${stamp}`);
  });
});
