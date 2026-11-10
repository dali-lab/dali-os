import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://dali:dali@localhost:5432/dali';
const BASE_URL = 'http://localhost:3001';

// Same first-run suppression the shared `page` fixture applies; extra contexts
// built with browser.newContext() don't get it.
const LAUNCH_WELCOME_SEEN_KEY = 'dalios-launch-welcome-seen-v1';

export type DocUser = { context: BrowserContext; page: Page };

/** A fresh browser context logged in as `daliEmail`, for multi-user specs. */
export async function openAs(browser: Browser, daliEmail: string): Promise<DocUser> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await context.addInitScript((key) => {
    try {
      window.localStorage.setItem(key, 'e2e');
    } catch {
      /* ignore */
    }
  }, LAUNCH_WELCOME_SEEN_KEY);
  await context.addCookies([{ name: 'dali_pk_prompt', value: '1', url: BASE_URL }]);
  const page = await context.newPage();
  await page.goto(`/dev-login-as?${new URLSearchParams({ daliEmail })}`);
  await page.waitForLoadState('networkidle');
  return { context, page };
}

/**
 * Create a Lab document owned by the signed-in user; returns its page id. New
 * lab docs default to General access "Everyone in the lab" (Edit), so this
 * switches the doc to "Only people you add" unless `restricted` is false.
 */
export async function createLabDoc(
  page: Page,
  title: string,
  { restricted = true }: { restricted?: boolean } = {},
): Promise<string> {
  const res = await page.request.post('/api/lab-documents', {
    data: { title, kind: 'FreeForm' },
  });
  expect(res.ok(), `create doc failed: ${await res.text()}`).toBe(true);
  const id = ((await res.json()) as { id: string }).id;
  if (restricted) {
    await shareIntent(page, id, {
      intent: 'general-access',
      linkAccess: 'Restricted',
      linkPermission: 'View',
    });
  }
  return id;
}

/** Editors load lazily and the shared server is busy; give them room. */
export const EDITOR_READY = { timeout: 90_000 };

/** Open a document and wait for its editor to mount. */
export async function openDoc(page: Page, pageId: string) {
  await page.goto(`/documents/${pageId}`, { waitUntil: 'domcontentloaded' });
  await expect(editorOf(page)).toBeVisible(EDITOR_READY);
}

export async function userIdByEmail(daliEmail: string): Promise<string> {
  const client = new pg.Client(DATABASE_URL);
  await client.connect();
  try {
    const { rows } = await client.query('SELECT id FROM "User" WHERE "daliEmail" = $1', [daliEmail]);
    if (!rows[0]) throw new Error(`no seeded user ${daliEmail}`);
    return rows[0].id as string;
  } finally {
    await client.end();
  }
}

/** POST an intent to the one sharing endpoint as the signed-in user. */
export async function shareIntent(page: Page, pageId: string, fields: Record<string, string>) {
  const res = await page.request.post(`/api/pages/${pageId}/share`, { form: fields });
  expect(res.ok(), `share ${fields.intent} failed: ${await res.text()}`).toBe(true);
}

/** The editor surface, once the collab connection is live and editable state is known. */
export function editorOf(page: Page) {
  return page.locator('.bn-editor');
}

/**
 * The document body as the server persisted it (decoded from the Yjs snapshot
 * in Postgres via the markdown export), so a pass proves the write reached the
 * database, not just the in-memory Hocuspocus room.
 */
export async function persistedMarkdown(page: Page, pageId: string): Promise<string> {
  const res = await page.request.get(`/documents/${pageId}/export?format=md`);
  return res.ok() ? await res.text() : '';
}

/** Hard-delete docs this spec created (shares, collab rows, page). */
export async function deleteDocs(pageIds: string[]) {
  if (pageIds.length === 0) return;
  const client = new pg.Client(DATABASE_URL);
  await client.connect();
  try {
    const names = pageIds.map((id) => `doc:${id}:body`);
    await client.query('DELETE FROM "PageShare" WHERE "pageId" = ANY($1)', [pageIds]);
    await client.query('DELETE FROM "CollabDocument" WHERE name = ANY($1)', [names]);
    await client.query('DELETE FROM "Page" WHERE id = ANY($1)', [pageIds]);
  } catch {
    /* best-effort cleanup: FKs from other tables just leave the row behind */
  } finally {
    await client.end();
  }
}
