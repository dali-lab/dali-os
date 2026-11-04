import { test, expect } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import {
  USERS,
  countPreferences,
  deleteAllPreferences,
  deleteNotificationsMatching,
  deleteTasksTitled,
  getPreferenceRow,
  notificationsFor,
  restorePreference,
  signedInPage,
  userIdByEmail,
} from './notify.helpers';

// An @mention in a task comment is the trigger: it is a muteable in-app event
// (pagedoc.mention) that always lands as its own card, unlike task.assigned
// which folds into the assignee's task card.

const PROJECT_ID = 'project-dali-os';
const STAMP = `E2E-notify-${Date.now()}`;
const MEMBER_HANDLE = '@marcusbell';
const CONTROL_HANDLE = '@priyaraman';
const EVENT = 'pagedoc.mention';

let memberId: string;
let controlId: string;
let hadPreferences: boolean;
let memberPrefBefore: Awaited<ReturnType<typeof getPreferenceRow>>;

async function createTask(page: Page, title: string): Promise<string> {
  const res = await page.request.post(`/api/projects/${PROJECT_ID}/tasks`, {
    data: {
      title,
      status: 'Todo',
      dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { id: string }).id;
}

/** Post a comment through the task modal, as a person would. */
async function comment(page: Page, taskId: string, text: string) {
  await page.goto(`/projects/${PROJECT_ID}?tab=board&task=${taskId}`);
  const box = page.getByPlaceholder(/Write a comment/);
  await expect(box).toBeVisible();
  await box.fill(text);
  const posted = page.waitForResponse(
    (r) => r.url().includes(`/api/tasks/${taskId}/comments`) && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  expect((await posted).ok()).toBe(true);
}

async function openBell(page: Page) {
  await page.getByRole('button', { name: /^Notifications,/ }).click();
  return page.getByRole('dialog');
}

// Hydration can land after the first click under load, so retry until it sticks.
async function openDocuments(page: Page) {
  const header = page.getByRole('button', { name: /^Documents/ });
  await expect(async () => {
    if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click();
    await expect(header).toHaveAttribute('aria-expanded', 'true', { timeout: 1500 });
  }).toPass();
}

// The form can reset its draft when the loader revalidates after hydration, so
// the toggle and the save are retried together until the POST goes through.
async function saveMentionInApp(page: Page, on: boolean) {
  const box = page.getByRole('checkbox', { name: 'Mentions in-app' });
  await expect(async () => {
    await box.setChecked(on, { force: true, timeout: 1500 });
    const saved = page.waitForResponse(
      (r) => r.url().includes('/settings/notifications') && r.request().method() === 'POST',
      { timeout: 8000 },
    );
    saved.catch(() => {});
    await page.getByRole('button', { name: 'Save', exact: true }).click({ timeout: 1500 });
    expect((await saved).ok()).toBe(true);
  }).toPass();
}

test.describe.serial('Mention notifications', () => {
  test.setTimeout(90_000);
  let member: { page: Page; context: BrowserContext };
  let admin: { page: Page; context: BrowserContext };
  let taskId: string;
  const title = `${STAMP} task`;

  test.beforeAll(async ({ browser, baseURL }: { browser: Browser; baseURL?: string }) => {
    memberId = await userIdByEmail(USERS.member);
    controlId = await userIdByEmail('priya.raman@dali.dartmouth.edu');
    memberPrefBefore = await getPreferenceRow(memberId, EVENT);
    hadPreferences = (await countPreferences(memberId)) > 0;
    member = await signedInPage(browser, baseURL!, USERS.member);
    admin = await signedInPage(browser, baseURL!, USERS.admin);
  });

  test.afterAll(async () => {
    await member?.context.close();
    await admin?.context.close();
    await restorePreference(memberId, EVENT, memberPrefBefore);
    if (!hadPreferences) await deleteAllPreferences(memberId);
    await deleteNotificationsMatching(STAMP);
    await deleteTasksTitled(STAMP);
  });

  test('a mention reaches the recipient, links to the task, and reads once opened', async () => {
    const page = admin.page;
    taskId = await createTask(page, title);
    await comment(page, taskId, `${MEMBER_HANDLE} please look ${STAMP}-one`);

    await member.page.goto('/');
    const bell = await openBell(member.page);
    const card = bell
      .locator('div')
      .filter({ hasText: `You were mentioned on: ${title}` })
      .filter({ has: member.page.getByRole('button', { name: 'Confirm' }) })
      .last();
    await expect(card).toBeVisible();
    await expect(card.getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      new RegExp(`task=${taskId}`),
    );

    const [row] = await notificationsFor(memberId, `${STAMP}-one`);
    expect(row.readAt).toBeNull();
    expect(row.link).toContain(`task=${taskId}`);

    const read = member.page.waitForResponse(
      (r) => r.url().includes(`/api/notifications/${row.id}/read`) && r.request().method() === 'POST',
    );
    await card.getByRole('button', { name: 'Confirm' }).click();
    expect((await read).ok()).toBe(true);
    await expect(card).toHaveCount(0);

    await member.page.reload();
    const after = await openBell(member.page);
    await expect(after.getByText(`You were mentioned on: ${title}`)).toHaveCount(0);
    expect((await notificationsFor(memberId, `${STAMP}-one`))[0].readAt).not.toBeNull();
  });

  test('turning in-app off for mentions stops new ones, and only for that person', async () => {
    const page = admin.page;
    await member.page.goto('/settings/notifications');
    await openDocuments(member.page);
    await expect(member.page.getByRole('checkbox', { name: 'Mentions in-app' })).toBeChecked();
    await saveMentionInApp(member.page, false);

    await member.page.reload();
    await openDocuments(member.page);
    await expect(member.page.getByRole('checkbox', { name: 'Mentions in-app' })).not.toBeChecked();
    expect((await getPreferenceRow(memberId, EVENT))?.inApp).toBe(false);

    // One comment mentions the muted member and a control. Once the control's
    // notification exists the send has run, so the member's absence is real.
    await comment(page, taskId, `${MEMBER_HANDLE} ${CONTROL_HANDLE} again ${STAMP}-two`);
    await expect
      .poll(async () => (await notificationsFor(controlId, `${STAMP}-two`)).length)
      .toBe(1);
    expect(await notificationsFor(memberId, `${STAMP}-two`)).toHaveLength(0);

    // Turning it back on restores delivery.
    await saveMentionInApp(member.page, true);
    await comment(page, taskId, `${MEMBER_HANDLE} back on ${STAMP}-three`);
    await expect
      .poll(async () => (await notificationsFor(memberId, `${STAMP}-three`)).length)
      .toBe(1);
  });
});
