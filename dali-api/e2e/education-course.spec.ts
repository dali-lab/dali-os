import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import {
  ADMIN_EMAIL,
  OUTSIDER,
  STUDENT,
  assignmentIdByTitle,
  createAssignmentRow,
  createCourse,
  deleteCourse,
  getSubmission,
  uid,
} from './education.helpers';

test.setTimeout(120_000);

// A click before React hydrates is dropped, so retry until the dialog opens.
async function openDialog(page: Page, buttonName: string) {
  const dialog = page.getByRole('dialog');
  await expect(async () => {
    if (!(await dialog.isVisible())) await page.getByRole('button', { name: buttonName }).click();
    await expect(dialog).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 60_000 });
}

const RUN = uid();
const OFFERING_ID = `e2e-course-${RUN}`;
const TITLE = `E2E Course ${RUN}`;
const hub = `/education/${OFFERING_ID}/hub`;

test.beforeAll(async () => {
  await createCourse({ id: OFFERING_ID, title: TITLE, studentEmail: STUDENT.daliEmail });
});

test.afterAll(async () => {
  await deleteCourse(OFFERING_ID);
});

test.describe.serial('assignment loop', () => {
  const ASSIGNMENT = `Reflection ${RUN}`;
  const ANSWER = `I learned about auto layout ${RUN}`;
  let assignmentId = '';

  test('instructor adds an assignment that the enrolled student sees', async ({ page, loginAs }) => {
    await loginAs({ daliEmail: ADMIN_EMAIL });
    await page.goto(`/education/manage/${OFFERING_ID}?tab=assignments`, { waitUntil: 'domcontentloaded' });
    const dialog = page.getByRole('dialog');
    await openDialog(page, 'Add assignment');
    await dialog.getByLabel('Title').fill(ASSIGNMENT);
    await dialog.locator('button[aria-haspopup="listbox"]').filter({ hasText: 'Text + files' }).click();
    await page.getByRole('option', { name: 'Text', exact: true }).click();
    await dialog.getByLabel('Points (optional)').fill('10');
    await dialog.getByRole('button', { name: 'Add assignment' }).click();
    await expect(page.getByText(ASSIGNMENT)).toBeVisible();

    await expect.poll(() => assignmentIdByTitle(OFFERING_ID, ASSIGNMENT)).not.toBeNull();
    assignmentId = (await assignmentIdByTitle(OFFERING_ID, ASSIGNMENT))!;

    await loginAs({ daliEmail: STUDENT.daliEmail });
    await page.goto(`${hub}?tab=sessions`);
    const row = page.getByText(ASSIGNMENT);
    await expect(row).toBeVisible();
    await expect(page.getByText('no due date')).toBeVisible();
  });

  test('student submits text and it persists after reload', async ({ page, loginAs }) => {
    await loginAs({ daliEmail: STUDENT.daliEmail });
    await page.goto(`/education/${OFFERING_ID}/assignments/${assignmentId}`);
    await expect(page.getByRole('heading', { name: ASSIGNMENT })).toBeVisible();

    await page.getByPlaceholder('Write your answer…').fill(ANSWER);
    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Resubmit' })).toBeVisible();

    await page.reload();
    await expect(page.getByPlaceholder('Write your answer…')).toHaveValue(ANSWER);
    await expect(page.getByRole('button', { name: 'Resubmit' })).toBeVisible();
    expect((await getSubmission(OFFERING_ID, ASSIGNMENT, STUDENT.daliEmail))?.textContent).toBe(ANSWER);

    await page.goto(`${hub}?tab=sessions`);
    await expect(page.getByText('Submitted', { exact: true })).toBeVisible();
  });

  test('instructor grades it and the student sees the grade', async ({ page, loginAs }) => {
    await loginAs({ daliEmail: ADMIN_EMAIL });
    await page.goto(`/education/manage/assignments/${assignmentId}`);
    await expect(page.getByText(ANSWER)).toBeVisible();
    await expect(page.getByText('1 submission')).toBeVisible();
    await page.getByLabel(/Score/).fill('9');
    await page.getByLabel('Grade', { exact: true }).fill('Great work');
    await page.getByRole('button', { name: 'Release grade' }).click();
    await expect(page.getByRole('button', { name: 'Update grade' })).toBeVisible();

    await loginAs({ daliEmail: STUDENT.daliEmail });
    await page.goto(`/education/${OFFERING_ID}/assignments/${assignmentId}`);
    await expect(page.getByText(/Grade · 9\/10 · Great work/)).toBeVisible();
    await page.goto(`${hub}?tab=sessions`);
    await expect(page.getByText('9/10')).toBeVisible();

    const row = await getSubmission(OFFERING_ID, ASSIGNMENT, STUDENT.daliEmail);
    expect(row).toMatchObject({ grade: 'Great work', score: 9 });
    expect(row?.gradedAt).not.toBeNull();
  });
});

test.describe('boundaries', () => {
  test('a past-due assignment cannot be submitted', async ({ page, loginAs }) => {
    const title = `Late work ${RUN}`;
    const id = `e2e-late-${RUN}`;
    await createAssignmentRow({
      id,
      offeringId: OFFERING_ID,
      title,
      type: 'Link',
      dueAt: new Date(Date.now() - 86_400_000),
    });
    await loginAs({ daliEmail: STUDENT.daliEmail });
    await page.goto(`/education/${OFFERING_ID}/assignments/${id}`);
    await expect(page.getByText('This assignment is past due.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit', exact: true })).toHaveCount(0);

    // The server refuses it too, not just the hidden form.
    const res = await page.request.post(`/education/${OFFERING_ID}/assignments/${id}`, {
      form: { intent: 'submit-assignment', link: 'https://example.edu/late', files: '[]', textContent: '' },
    });
    expect(await res.text()).toContain('past due');
    expect(await getSubmission(OFFERING_ID, title, STUDENT.daliEmail)).toBeNull();
  });

  test('a member who is not enrolled is sent back to the offering page', async ({ page, loginAs }) => {
    const id = `e2e-closed-${RUN}`;
    await createAssignmentRow({
      id,
      offeringId: OFFERING_ID,
      title: `Closed ${RUN}`,
      type: 'Complete',
      dueAt: null,
    });
    await loginAs({ daliEmail: OUTSIDER.daliEmail });
    await page.goto(hub);
    await expect(page).toHaveURL(new RegExp(`/education/${OFFERING_ID}$`));
    await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();

    await page.goto(`/education/${OFFERING_ID}/assignments/${id}`);
    await expect(page).toHaveURL(new RegExp(`/education/${OFFERING_ID}$`));

    await page.request.post(`/education/${OFFERING_ID}/assignments/${id}`, {
      form: { intent: 'submit-assignment', files: '[]', textContent: '', link: '' },
    });
    expect(await getSubmission(OFFERING_ID, `Closed ${RUN}`, OUTSIDER.daliEmail)).toBeNull();
  });
});

test.describe.serial('discussion', () => {
  const ANNOUNCEMENT = `Bring laptops ${RUN}`;
  const QUESTION = `Where do we meet ${RUN}?`;
  const REPLY = `Room 007 ${RUN}`;

  test('instructor announcement reaches the enrolled student', async ({ page, loginAs }) => {
    await loginAs({ daliEmail: ADMIN_EMAIL });
    await page.goto(`/education/manage/${OFFERING_ID}?tab=announcements`, { waitUntil: 'domcontentloaded' });
    const dialog = page.getByRole('dialog');
    await openDialog(page, 'New announcement');
    await dialog.getByRole('textbox').fill(ANNOUNCEMENT);
    await dialog.getByRole('button', { name: 'Send announcement' }).click();
    await expect(page.getByText(ANNOUNCEMENT)).toBeVisible({ timeout: 30_000 });

    await loginAs({ daliEmail: STUDENT.daliEmail });
    await page.goto(`${hub}?tab=discussions`);
    await expect(page.getByRole('heading', { name: 'Announcements' })).toBeVisible();
    await expect(page.getByText(ANNOUNCEMENT)).toBeVisible({ timeout: 30_000 });

    await page.reload();
    await expect(page.getByText(ANNOUNCEMENT)).toBeVisible({ timeout: 30_000 });
  });

  test('student posts a question and the instructor replies', async ({ page, loginAs }) => {
    await loginAs({ daliEmail: STUDENT.daliEmail });
    await page.goto(`${hub}?tab=discussions`);
    await page.getByPlaceholder('Ask a question or share something with the class…').fill(QUESTION);
    await page.getByRole('button', { name: 'Post', exact: true }).click();
    await expect(page.getByText(QUESTION)).toBeVisible({ timeout: 30_000 });

    await loginAs({ daliEmail: ADMIN_EMAIL });
    await page.goto(`${hub}?tab=discussions`);
    await expect(page.getByText(QUESTION)).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Reply' }).click();
    await page.getByPlaceholder('Write a reply…').fill(REPLY);
    await page.getByRole('button', { name: 'Reply' }).last().click();
    await expect(page.getByText(REPLY)).toBeVisible({ timeout: 30_000 });

    await loginAs({ daliEmail: STUDENT.daliEmail });
    await page.goto(`${hub}?tab=discussions`);
    await expect(page.getByText(QUESTION)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(REPLY)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Instructor', { exact: true })).toBeVisible();
  });
});
