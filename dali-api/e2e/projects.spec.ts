import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import {
  PROJECT_ID,
  MEMBER_A,
  MEMBER_B,
  OUTSIDER,
  stamp,
  todayKey,
  addMembers,
  removeMembers,
  cleanupTagged,
  taskRow,
} from './projects.helpers';

// The project workspace: epic -> story -> task creation through the UI, then
// the things that depend on it (assignment, comments, the deadline rule, who
// may write). Every row carries TAG so afterAll can remove exactly what this
// run made on the shared database.

const TAG = stamp();
const EPIC = `E2E epic ${TAG}`;
const STORY = `E2E story ${TAG}`;
const TASK = `E2E task ${TAG}`;
const URL = `/projects/${PROJECT_ID}`;

let assignmentIds: string[] = [];

test.beforeAll(async () => {
  assignmentIds = await addMembers([MEMBER_A.email, MEMBER_B.email]);
});

test.afterAll(async () => {
  await cleanupTagged(TAG);
  await removeMembers(assignmentIds);
});

async function openProject(page: Page) {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="board-column"]').first()).toBeVisible();
  // networkidle never settles on this page (live streams), so wait for React to
  // attach to the board instead: clicking before that submits plain HTML forms.
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="board-column"]');
    return !!el && Object.keys(el).some((k) => k.startsWith('__reactFiber'));
  });
}

async function openTask(page: Page, id: string) {
  await page.goto(`${URL}?tab=progress&task=${id}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.waitForFunction(() => {
    const el = document.querySelector('[role="dialog"]');
    return !!el && Object.keys(el).some((k) => k.startsWith('__reactProps') || k.startsWith('__reactFiber'));
  });
}

async function pickDate(page: Page, label: string, key: string) {
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.locator(`[data-day="${key}"]`).click();
}

test.describe.configure({ mode: 'serial', timeout: 150_000 });

test.describe('Projects: epics, stories and tasks', () => {
  test('a project member builds epic -> story -> task and the nesting survives a reload', async ({
    page,
    loginAs,
  }) => {
    await loginAs({ daliEmail: MEMBER_A.email });
    await openProject(page);

    await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Epic' }).click();
    await page.getByLabel('Name').fill(EPIC);
    const epicSaved = page.waitForResponse(
      (r) => r.url().endsWith(`/api/projects/${PROJECT_ID}/epics`) && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Next' }).click();
    expect((await epicSaved).ok()).toBe(true);

    // The epic's detail modal opens next; add the story in place.
    const epicDialog = page.getByRole('dialog').filter({ hasText: 'User stories' });
    await epicDialog.getByRole('button', { name: 'New story' }).click();
    const storySaved = page.waitForResponse(
      (r) => /\/api\/epics\/[^/]+\/stories$/.test(r.url()) && r.request().method() === 'POST',
    );
    await epicDialog.getByLabel('New story name').fill(STORY);
    await page.keyboard.press('Enter');
    expect((await storySaved).ok()).toBe(true);

    await epicDialog.getByRole('button', { name: `Add task to ${STORY}` }).click();
    const taskDialog = page.getByRole('dialog').filter({ hasText: 'New task' });
    await taskDialog.getByPlaceholder('What needs doing?').fill(TASK);
    await pickDate(page, 'Deadline', todayKey(2));
    const taskSaved = page.waitForResponse(
      (r) => r.url().endsWith(`/api/projects/${PROJECT_ID}/tasks`) && r.request().method() === 'POST',
    );
    await taskDialog.getByRole('button', { name: 'Create task' }).click();
    expect((await taskSaved).ok()).toBe(true);

    const rows = await taskRow(TASK);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.storyTitle).toBe(STORY);
    expect(rows[0]!.epicTitle).toBe(EPIC);
    expect(rows[0]!.status).toBe('Todo');

    await openProject(page);
    await expect(page.locator('[data-testid="task-card"]').filter({ hasText: TASK })).toBeVisible();

    // Nesting as the member sees it: the task modal names its story and epic.
    await openTask(page, rows[0]!.id);
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(STORY)).toBeVisible();
    await expect(dialog.getByText(EPIC)).toBeVisible();
  });

  test('assigning a task puts it on the assignee\'s My Tasks, and a comment reaches them', async ({
    page,
    loginAs,
  }) => {
    const [{ id }] = await taskRow(TASK);
    const comment = `E2E comment ${TAG}`;

    await loginAs({ daliEmail: MEMBER_A.email });
    await openTask(page, id);
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Edit task' }).click();
    await dialog.getByRole('button', { name: 'Assign someone' }).click();
    await page.getByRole('menu').getByText(MEMBER_B.name).click();
    // Not Escape: that reaches the modal and asks to discard the edit.
    await dialog.getByText('Assignees', { exact: true }).click();
    const saved = page.waitForResponse(
      (r) => r.url().includes(`/api/tasks/${id}`) && r.request().method() !== 'GET',
    );
    await dialog.getByRole('button', { name: 'Save' }).click();
    expect((await saved).ok()).toBe(true);

    await openTask(page, id);
    const commentSaved = page.waitForResponse(
      (r) => r.url().endsWith(`/api/tasks/${id}/comments`) && r.request().method() === 'POST',
    );
    const box = dialog.getByPlaceholder(/Write a comment/);
    const post = dialog.getByRole('button', { name: 'Comment', exact: true });
    await expect(async () => {
      await box.fill(comment);
      await expect(post).toBeEnabled({ timeout: 2000 });
    }).toPass();
    await post.click();
    expect((await commentSaved).ok()).toBe(true);

    // The other member: the task is on their list, and the comment is on it.
    await loginAs({ daliEmail: MEMBER_B.email });
    await page.goto('/notifications', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(TASK)).toBeVisible();
    await page.getByRole('link', { name: 'Open task' }).first().click();
    await expect(page.getByRole('dialog').getByText(comment)).toBeVisible({ timeout: 30_000 });
  });

  test('a non-Backlog task needs a deadline: the form refuses it and so does the API', async ({
    page,
    loginAs,
  }) => {
    const title = `E2E nodue ${TAG}`;
    await loginAs({ daliEmail: MEMBER_A.email });
    await openProject(page);

    await page.getByRole('button', { name: 'Add new task' }).first().click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'New task' });
    await dialog.getByPlaceholder('What needs doing?').fill(title);
    await expect(dialog.getByText('Required unless the task starts in Backlog.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Create task' })).toBeDisabled();

    const direct = await page.request.post(`/api/projects/${PROJECT_ID}/tasks`, {
      data: { title, status: 'Todo' },
    });
    expect(direct.status()).toBe(400);
    expect((await direct.json()).error).toBe('Give the task a deadline, or create it in Backlog.');
    expect(await taskRow(title)).toHaveLength(0);

    // Backlog is the exception: undated work is allowed there.
    const backlog = await page.request.post(`/api/projects/${PROJECT_ID}/tasks`, {
      data: { title, status: 'Backlog' },
    });
    expect(backlog.ok()).toBe(true);
    const rows = await taskRow(title);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('Backlog');
    expect(rows[0]!.dueAt).toBeNull();
  });

  test('a member who is not on the project cannot create, edit or comment', async ({
    page,
    loginAs,
  }) => {
    const [{ id }] = await taskRow(TASK);
    const blocked = `E2E blocked ${TAG}`;
    await loginAs({ daliEmail: OUTSIDER.email });
    await openProject(page);

    await expect(page.locator('[data-testid="task-card"]').filter({ hasText: TASK })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add new task' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New', exact: true })).toHaveCount(0);

    await openTask(page, id);
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(TASK)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Edit task' })).toHaveCount(0);

    const dueAt = new Date(Date.now() + 86_400_000).toISOString();
    const create = await page.request.post(`/api/projects/${PROJECT_ID}/tasks`, {
      data: { title: blocked, status: 'Todo', dueAt },
    });
    expect(create.status()).toBe(403);
    const epic = await page.request.post(`/api/projects/${PROJECT_ID}/epics`, {
      data: { title: `E2E blocked epic ${TAG}` },
    });
    expect(epic.status()).toBe(403);
    const comment = await page.request.post(`/api/tasks/${id}/comments`, {
      data: { body: `E2E blocked comment ${TAG}` },
    });
    expect(comment.status()).toBe(403);
    expect(await taskRow(blocked)).toHaveLength(0);
  });
});
